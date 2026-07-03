import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaddleProvider } from "../../../payment/providers/paddle/paddle.provider.js";
import { getPaddle, getPaddleWebhookSecret } from "../../../modules/billing/config/paddle.js";

// Mock Paddle SDK
vi.mock("../../../modules/billing/config/paddle.js", () => ({
  getPaddle: vi.fn(),
  getPaddleWebhookSecret: vi.fn(),
  PADDLE_PRICE_IDS: {
    PRO: { monthly: "price_pro_mo", yearly: "price_pro_yr" },
  },
  PADDLE_PRICE_TO_PLAN: new Map([
    ["price_pro_mo", { planName: "PRO" }],
    ["price_pro_yr", { planName: "PRO" }],
  ]),
}));

describe("PaddleProvider", () => {
  let provider: PaddleProvider;
  let paddleMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    paddleMock = {
      customers: { create: vi.fn() },
      transactions: { create: vi.fn() },
      customerPortalSessions: { create: vi.fn() },
      subscriptions: {
        get: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn(),
      },
      webhooks: {
        unmarshal: vi.fn(),
      },
    };

    vi.mocked(getPaddle).mockReturnValue(paddleMock);
    vi.mocked(getPaddleWebhookSecret).mockReturnValue("paddle_sec_123");

    provider = new PaddleProvider();
  });

  describe("createCustomer", () => {
    it("should create a customer using the paddle SDK", async () => {
      paddleMock.customers.create.mockResolvedValue({ id: "cus_paddle_123" });

      const result = await provider.createCustomer({
        email: "test@example.com",
        name: "Test User",
        metadata: { foo: "bar" },
      });

      expect(paddleMock.customers.create).toHaveBeenCalledWith({
        email: "test@example.com",
        name: "Test User",
        customData: { foo: "bar" },
      });
      expect(result).toEqual({ providerCustomerId: "cus_paddle_123" });
    });
  });

  describe("createCheckoutSession", () => {
    it("should create a transaction for checkout", async () => {
      paddleMock.transactions.create.mockResolvedValue({
        checkout: { url: "https://checkout.paddle.com/txn_123" },
      });

      const result = await provider.createCheckoutSession({
        providerCustomerId: "cus_paddle_123",
        planName: "PRO",
        billingCycle: "MONTHLY",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        workspaceId: "ws_123",
        ownerId: "user_123",
        trialDays: 14,
        metadata: { some: "meta" },
      });

      expect(paddleMock.transactions.create).toHaveBeenCalledWith({
        customerId: "cus_paddle_123",
        items: [{ priceId: "price_pro_mo", quantity: 1 }],
        checkout: { url: "https://example.com/success" },
        customData: {
          workspaceId: "ws_123",
          ownerId: "user_123",
          planName: "PRO",
          billingCycle: "MONTHLY",
        },
      });
      expect(result).toEqual({ url: "https://checkout.paddle.com/txn_123" });
    });
  });

  describe("createPortalSession", () => {
    it("should create a portal session", async () => {
      paddleMock.customerPortalSessions.create.mockResolvedValue({
        urls: { general: { overview: "https://paddle.com/portal/123" } },
      });

      const result = await provider.createPortalSession({
        providerCustomerId: "cus_paddle_123",
        returnUrl: "https://example.com/return",
      });

      expect(paddleMock.customerPortalSessions.create).toHaveBeenCalledWith(
        "cus_paddle_123",
        [],
      );
      expect(result).toEqual({ url: "https://paddle.com/portal/123" });
    });
  });

  describe("changePlan", () => {
    it("should update subscription items", async () => {
      paddleMock.subscriptions.get.mockResolvedValue({
        id: "sub_paddle_123",
        items: [{ priceId: "price_old", quantity: 1 }],
      });

      await provider.changePlan({
        providerSubscriptionId: "sub_paddle_123",
        newProviderPriceId: "price_pro_yr",
        isUpgrade: true,
        metadata: { reason: "upgrade" },
      });

      expect(paddleMock.subscriptions.update).toHaveBeenCalledWith("sub_paddle_123", {
        items: [{ priceId: "price_pro_yr", quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
        customData: { reason: "upgrade" },
      });
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription", async () => {
      await provider.cancelSubscription({
        providerSubscriptionId: "sub_paddle_123",
        immediately: true,
      });

      expect(paddleMock.subscriptions.cancel).toHaveBeenCalledWith("sub_paddle_123", {
        effectiveFrom: "immediately",
      });
    });

    it("should cancel at next billing period", async () => {
      await provider.cancelSubscription({
        providerSubscriptionId: "sub_paddle_123",
        immediately: false,
      });

      expect(paddleMock.subscriptions.cancel).toHaveBeenCalledWith("sub_paddle_123", {
        effectiveFrom: "next_billing_period",
      });
    });
  });

  describe("reactivateSubscription", () => {
    it("should clear scheduled change", async () => {
      await provider.reactivateSubscription({
        providerSubscriptionId: "sub_paddle_123",
      });

      expect(paddleMock.subscriptions.update).toHaveBeenCalledWith("sub_paddle_123", {
        scheduledChange: null,
      });
    });
  });

  describe("verifyAndParseWebhook", () => {
    const mockHeaders = { "paddle-signature": "sig_paddle_123" };
    const mockRawBody = Buffer.from("event_body");

    it("should throw error if signature is missing", async () => {
      await expect(
        provider.verifyAndParseWebhook(mockRawBody, {})
      ).rejects.toThrow("[PaddleProvider] Missing signature");
    });

    it("should throw error if unmarshal fails", async () => {
      paddleMock.webhooks.unmarshal.mockResolvedValue(null);

      await expect(
        provider.verifyAndParseWebhook(mockRawBody, mockHeaders)
      ).rejects.toThrow("[PaddleProvider] Invalid webhook");
    });

    it("should normalize a SubscriptionCreated event", async () => {
      const mockEvent = {
        eventId: "evt_paddle_1",
        eventType: "subscription.created",
        data: {
          id: "sub_paddle_123",
          customerId: "cus_paddle_123",
          status: "active",
          items: [{ price: { id: "price_pro_mo", billingCycle: { interval: "month" } } }],
          currentBillingPeriod: { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" },
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "SUBSCRIPTION_CREATED",
        providerEventId: "evt_paddle_1",
        providerSubscriptionId: "sub_paddle_123",
        status: "ACTIVE",
        planName: "PRO",
      }));
    });

    it("should return null for unknown event types", async () => {
      paddleMock.webhooks.unmarshal.mockResolvedValue({
        eventId: "evt_paddle_2",
        eventType: "transaction.completed",
        data: {},
      });

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);
      expect(result).toBeNull();
    });
  });
});
