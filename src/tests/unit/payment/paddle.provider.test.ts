import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaddleProvider } from "../../../payment/providers/paddle/paddle.provider.js";
import { getPaddle, getPaddleWebhookSecret } from "../../../modules/billing/config/paddle.js";
import { CacheClient, CACHE_KEYS } from "../../../lib/redis/cache.client.js";

// Mock Paddle SDK
vi.mock("../../../modules/billing/config/paddle.js", () => ({
  getPaddle: vi.fn(),
  getPaddleWebhookSecret: vi.fn(),
  PADDLE_PRICE_IDS: {
    PRO: { monthly: "price_pro_mo", yearly: "price_pro_yr" },
    BUSINESS: { monthly: "price_biz_mo", yearly: "price_biz_yr" },
  },
  PADDLE_PRICE_TO_PLAN: new Map([
    ["price_pro_mo", { planName: "PRO", cycle: "MONTHLY" }],
    ["price_pro_yr", { planName: "PRO", cycle: "YEARLY" }],
    ["price_biz_mo", { planName: "BUSINESS", cycle: "MONTHLY" }],
    ["price_biz_yr", { planName: "BUSINESS", cycle: "YEARLY" }],
  ]),
}));

describe("PaddleProvider", () => {
  let provider: PaddleProvider;
  let paddleMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear common cache keys used in tests to avoid leakage between tests
    await CacheClient.delete(
      CACHE_KEYS.paddleCustomer("test@example.com"),
      `api:paddle:portal:cus_paddle_123`
    );

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

    it("should return cached customer if already exists", async () => {
      const mockCustomer = { id: "cus_paddle_cached" };
      paddleMock.customers.create.mockResolvedValue(mockCustomer);
      const email = "test@example.com";

      // First call - hits API
      await provider.createCustomer({ email, name: "User", metadata: {} });
      expect(paddleMock.customers.create).toHaveBeenCalledTimes(1);

      // Second call - hits cache
      const result = await provider.createCustomer({ email, name: "User", metadata: {} });
      expect(paddleMock.customers.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ providerCustomerId: "cus_paddle_cached" });
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

    it("should throw error if no checkout URL returned", async () => {
      paddleMock.transactions.create.mockResolvedValue({
        checkout: { url: null },
      });

      await expect(
        provider.createCheckoutSession({
          providerCustomerId: "cus_paddle_123",
          planName: "PRO",
          billingCycle: "MONTHLY",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          workspaceId: "ws_123",
          ownerId: "user_123",
          metadata: {},
        })
      ).rejects.toThrow("[PaddleProvider] No checkout URL");
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

    it("should use prorated_next_billing_period for downgrades", async () => {
      paddleMock.subscriptions.get.mockResolvedValue({
        id: "sub_paddle_123",
        items: [{ priceId: "price_old", quantity: 1 }],
      });

      await provider.changePlan({
        providerSubscriptionId: "sub_paddle_123",
        newProviderPriceId: "price_pro_mo",
        isUpgrade: false,
        metadata: { reason: "downgrade" },
      });

      expect(paddleMock.subscriptions.update).toHaveBeenCalledWith("sub_paddle_123", {
        items: [{ priceId: "price_pro_mo", quantity: 1 }],
        prorationBillingMode: "prorated_next_billing_period",
        customData: { reason: "downgrade" },
      });
    });

    it("should invalidate cache on changePlan", async () => {
      paddleMock.subscriptions.get.mockResolvedValue({
        id: "sub_paddle_cache_123",
        items: [{ priceId: "price_old", quantity: 1 }],
      });

      const cacheKey = CACHE_KEYS.paddleSubscription("sub_paddle_cache_123");
      await CacheClient.set(cacheKey, { id: "sub_paddle_cache_123", items: [{ priceId: "price_old", quantity: 1 }] }, 60);

      await provider.changePlan({
        providerSubscriptionId: "sub_paddle_cache_123",
        newProviderPriceId: "price_pro_yr",
        isUpgrade: true,
        metadata: { reason: "upgrade" },
      });

      expect(paddleMock.subscriptions.get).not.toHaveBeenCalled();

      const cached = await CacheClient.get(cacheKey);
      expect(cached).toBeNull();
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription immediately", async () => {
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

    it("should normalize a SubscriptionTrialing event with trialStart", async () => {
      const mockEvent = {
        eventId: "evt_paddle_trial",
        eventType: "subscription.trialing",
        data: {
          id: "sub_paddle_trial",
          customerId: "cus_paddle_123",
          status: "trialing",
          startedAt: "2026-01-15T00:00:00Z",
          nextBilledAt: "2026-01-29T00:00:00Z",
          items: [{ price: { id: "price_pro_mo", billingCycle: { interval: "month" } } }],
          currentBillingPeriod: { startsAt: "2026-01-15T00:00:00Z", endsAt: "2026-01-29T00:00:00Z" },
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "SUBSCRIPTION_TRIAL_ENDING",
        providerSubscriptionId: "sub_paddle_trial",
        status: "TRIALING",
        trialStart: new Date("2026-01-15T00:00:00Z"),
        trialEnd: new Date("2026-01-29T00:00:00Z"),
      }));
    });

    it("should normalize a TransactionCompleted event as INVOICE_PAID", async () => {
      const mockEvent = {
        eventId: "evt_txn_1",
        eventType: "transaction.completed",
        data: {
          id: "txn_123",
          customerId: "cus_paddle_123",
          subscriptionId: "sub_paddle_123",
          status: "completed",
          currencyCode: "USD",
          invoiceNumber: "INV-001",
          details: {
            totals: { grandTotal: "1000", total: "1000" },
            lineItems: [
              { priceId: "price_pro_mo", quantity: 1, product: { name: "PRO Plan" }, unitTotals: { total: "1000" }, totals: { total: "1000" } },
            ],
          },
          payments: [{
            paymentAttemptId: "paymtatt_123",
            amount: "1000",
            status: "captured",
            capturedAt: "2026-01-15T12:00:00Z",
            createdAt: "2026-01-15T12:00:00Z",
            methodDetails: {
              type: "card",
              card: { last4: "4242" },
            },
          }],
          billingPeriod: { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" },
          customData: { workspaceId: "ws_123", ownerId: "user_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_PAID",
        providerEventId: "evt_txn_1",
        providerInvoiceId: "txn_123",
        providerCustomerId: "cus_paddle_123",
        providerSubscriptionId: "sub_paddle_123",
        providerPaymentId: "paymtatt_123",
        amountDue: 1000,
        amountPaid: 1000,
        amountRemaining: 0,
        currency: "usd",
        status: "PAID",
        invoiceNumber: "INV-001",
        paymentMethodType: "card",
        cardLast4: "4242",
        paidAt: new Date("2026-01-15T12:00:00Z"),
        attemptCount: 1,
        metadata: { workspaceId: "ws_123", ownerId: "user_123" },
      }));
      const invoiceResult = result as any;
      expect(invoiceResult.lineItems).toEqual([
        { priceId: "price_pro_mo", quantity: 1, name: "PRO Plan", amount: 1000 },
      ]);
    });

    it("should normalize a TransactionPaymentFailed event as INVOICE_PAYMENT_FAILED", async () => {
      const mockEvent = {
        eventId: "evt_txn_fail",
        eventType: "transaction.payment_failed",
        data: {
          id: "txn_fail_123",
          customerId: "cus_paddle_123",
          subscriptionId: "sub_paddle_123",
          status: "past_due",
          currencyCode: "USD",
          details: {
            totals: { grandTotal: "1000", total: "1000" },
            lineItems: [],
          },
          payments: [{
            paymentAttemptId: "paymtatt_fail",
            amount: "0",
            status: "failed",
            methodDetails: null,
          }],
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_PAYMENT_FAILED",
        providerInvoiceId: "txn_fail_123",
        amountDue: 1000,
        amountPaid: 0,
        status: "UNCOLLECTIBLE",
        paymentMethodType: null,
        cardLast4: null,
        paidAt: null,
      }));
    });

    it("should normalize a TransactionBilled event as INVOICE_CREATED", async () => {
      const mockEvent = {
        eventId: "evt_txn_billed",
        eventType: "transaction.billed",
        data: {
          id: "txn_billed_123",
          customerId: "cus_paddle_123",
          subscriptionId: "sub_paddle_123",
          status: "billed",
          currencyCode: "USD",
          details: {
            totals: { grandTotal: "1000", total: "1000" },
            lineItems: [],
          },
          payments: [],
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_CREATED",
        providerInvoiceId: "txn_billed_123",
        amountDue: 1000,
        status: "OPEN",
        attemptCount: 0,
      }));
    });

    it("should normalize a TransactionUpdated event as INVOICE_UPDATED", async () => {
      const mockEvent = {
        eventId: "evt_txn_updated",
        eventType: "transaction.updated",
        data: {
          id: "txn_updated_123",
          customerId: "cus_paddle_123",
          subscriptionId: "sub_paddle_123",
          status: "completed",
          currencyCode: "USD",
          details: {
            totals: { grandTotal: "2000", total: "2000" },
            lineItems: [],
          },
          payments: [{
            paymentAttemptId: "paymtatt_upd",
            amount: "2000",
            status: "captured",
            capturedAt: "2026-01-20T12:00:00Z",
            methodDetails: { type: "card", card: { last4: "1234" } },
          }],
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_UPDATED",
        providerInvoiceId: "txn_updated_123",
        amountDue: 2000,
        amountPaid: 2000,
        status: "PAID",
      }));
    });

    it("should return null for unhandled event types", async () => {
      paddleMock.webhooks.unmarshal.mockResolvedValue({
        eventId: "evt_paddle_2",
        eventType: "customer.created",
        data: {},
      });

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);
      expect(result).toBeNull();
    });

    it("should handle transaction with no payments gracefully", async () => {
      const mockEvent = {
        eventId: "evt_txn_no_pay",
        eventType: "transaction.completed",
        data: {
          id: "txn_no_pay",
          customerId: "cus_paddle_123",
          subscriptionId: null,
          status: "completed",
          currencyCode: "USD",
          details: {
            totals: { grandTotal: "500", total: "500" },
            lineItems: [],
          },
          payments: [],
          customData: { workspaceId: "ws_123" },
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_PAID",
        amountDue: 500,
        amountPaid: 0,
        amountRemaining: 500,
        providerPaymentId: null,
        paymentMethodType: null,
        cardLast4: null,
        paidAt: null,
        attemptCount: 0,
      }));
    });

    it("should handle transaction with null details gracefully", async () => {
      const mockEvent = {
        eventId: "evt_txn_null_details",
        eventType: "transaction.completed",
        data: {
          id: "txn_null_details",
          customerId: "cus_paddle_123",
          subscriptionId: null,
          status: "completed",
          currencyCode: "USD",
          details: null,
          payments: [],
          customData: {},
        },
      };
      paddleMock.webhooks.unmarshal.mockResolvedValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_PAID",
        amountDue: 0,
        amountPaid: 0,
        metadata: {},
      }));
    });
  });
});
