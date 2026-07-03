import { describe, it, expect, vi, beforeEach } from "vitest";
import { StripeProvider } from "../../../payment/providers/stripe/stripe.provider.js";
import { prisma } from "../../../lib/prisma.js";
import Stripe from "stripe";

// Mock Stripe SDK
vi.mock("stripe", () => {
  const stripeInstance = {
    customers: {
      create: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
    },
    paymentIntents: {
      retrieve: vi.fn(),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };

  return {
    default: vi.fn().mockImplementation(() => stripeInstance),
  };
});

// Helper to access the mocked instance in tests
// Since the instance is created inside the mock factory, we can retrieve it 
// by instantiating the mocked class.
const getStripeMock = () => new (Stripe as any)();

// Mock Prisma
vi.mock("../../../lib/prisma.js", () => {
  return {
    prisma: {
      plan: {
        findFirst: vi.fn(),
      },
    },
  };
});

describe("StripeProvider", () => {
  let provider: StripeProvider;
  let stripeMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_mo";
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_yr";

    provider = new StripeProvider();
    stripeMock = getStripeMock();
  });

  describe("createCustomer", () => {
    it("should create a customer using the stripe SDK", async () => {
      const mockCustomer = { id: "cus_123" };
      stripeMock.customers.create.mockResolvedValue(mockCustomer);

      const result = await provider.createCustomer({
        email: "test@example.com",
        name: "Test User",
        metadata: { foo: "bar" },
      });

      expect(stripeMock.customers.create).toHaveBeenCalledWith({
        email: "test@example.com",
        name: "Test User",
        metadata: { foo: "bar" },
      });
      expect(result).toEqual({ providerCustomerId: "cus_123" });
    });
  });

  describe("createCheckoutSession", () => {
    it("should create a checkout session with correct params", async () => {
      const mockSession = { url: "https://checkout.stripe.com/pay/cs_test_123" };
      stripeMock.checkout.sessions.create.mockResolvedValue(mockSession);

      const result = await provider.createCheckoutSession({
        providerCustomerId: "cus_123",
        planName: "PRO",
        billingCycle: "MONTHLY",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        workspaceId: "ws_123",
        ownerId: "user_123",
        trialDays: 14,
        metadata: { some: "meta" },
      });

      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith({
        mode: "subscription",
        customer: "cus_123",
        line_items: [{ price: "price_pro_mo", quantity: 1 }],
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { workspaceId: "ws_123", ownerId: "user_123" },
          trial_period_days: 14,
        },
        metadata: { some: "meta" },
      });
      expect(result).toEqual({ url: "https://checkout.stripe.com/pay/cs_test_123" });
    });

    it("should throw error if price ID is not configured in env", async () => {
      delete process.env.STRIPE_PRICE_PRO_MONTHLY;
      
      await expect(
        provider.createCheckoutSession({
          providerCustomerId: "cus_123",
          planName: "PRO",
          billingCycle: "MONTHLY",
          successUrl: "ok",
          cancelUrl: "cancel",
          workspaceId: "ws",
          ownerId: "u",
          trialDays: 0,
          metadata: {},
        })
      ).rejects.toThrow("[StripeProvider] No price configured for env var: STRIPE_PRICE_PRO_MONTHLY");
    });
  });

  describe("createPortalSession", () => {
    it("should create a portal session", async () => {
      const mockSession = { url: "https://billing.stripe.com/portal/sess_123" };
      stripeMock.billingPortal.sessions.create.mockResolvedValue(mockSession);

      const result = await provider.createPortalSession({
        providerCustomerId: "cus_123",
        returnUrl: "https://example.com/return",
      });

      expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_123",
        return_url: "https://example.com/return",
      });
      expect(result).toEqual({ url: "https://billing.stripe.com/portal/sess_123" });
    });
  });

  describe("changePlan", () => {
    it("should update the subscription with a new price", async () => {
      const mockSub = {
        id: "sub_123",
        items: { data: [{ id: "si_123" }] },
      };
      stripeMock.subscriptions.retrieve.mockResolvedValue(mockSub);

      await provider.changePlan({
        providerSubscriptionId: "sub_123",
        newProviderPriceId: "price_new",
        isUpgrade: true,
        metadata: { reason: "upgrade" },
      });

      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_123", {
        items: [{ id: "si_123", price: "price_new" }],
        proration_behavior: "always_invoice",
        metadata: { reason: "upgrade" },
      });
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel immediately when requested", async () => {
      await provider.cancelSubscription({
        providerSubscriptionId: "sub_123",
        immediately: true,
      });

      expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_123");
    });

    it("should cancel at period end when requested", async () => {
      await provider.cancelSubscription({
        providerSubscriptionId: "sub_123",
        immediately: false,
        reason: "too expensive",
      });

      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_123", {
        cancel_at_period_end: true,
        metadata: { cancelReason: "too expensive" },
      });
    });
  });

  describe("reactivateSubscription", () => {
    it("should set cancel_at_period_end to false", async () => {
      await provider.reactivateSubscription({
        providerSubscriptionId: "sub_123",
      });

      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_123", {
        cancel_at_period_end: false,
      });
    });
  });

  describe("verifyAndParseWebhook", () => {
    const mockHeaders = { "stripe-signature": "sig_123" };
    const mockRawBody = Buffer.from("event_body");

    it("should throw error on invalid signature", async () => {
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      await expect(
        provider.verifyAndParseWebhook(mockRawBody, mockHeaders)
      ).rejects.toThrow("[StripeProvider] Webhook signature invalid: Invalid signature");
    });

    it("should return null for unknown event types", async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: "evt_1",
        type: "unknown.event",
        data: { object: {} },
      });

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);
      expect(result).toBeNull();
    });

    it("should normalize a customer.subscription.created event", async () => {
      const mockEvent = {
        id: "evt_sub_created",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "active",
            current_period_start: 1700000000,
            current_period_end: 1702600000,
            cancel_at_period_end: false,
            canceled_at: null,
            trial_start: null,
            trial_end: null,
            metadata: { workspaceId: "ws_123" },
            items: {
              data: [{
                price: { id: "price_pro_mo", recurring: { interval: "month" } },
              }],
            },
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);
      vi.mocked(prisma.plan.findFirst).mockResolvedValue({ name: "PRO" } as any);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "SUBSCRIPTION_CREATED",
        providerEventId: "evt_sub_created",
        providerSubscriptionId: "sub_123",
        status: "ACTIVE",
        planName: "PRO",
        billingCycle: "MONTHLY",
      }));
    });

    it("should normalize a checkout.session.completed event", async () => {
      const mockEvent = {
        id: "evt_checkout",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            subscription: "sub_123",
            customer: "cus_123",
            metadata: { planName: "PRO", billingCycle: "MONTHLY" },
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "CHECKOUT_COMPLETED",
        providerSubscriptionId: "sub_123",
        planName: "PRO",
        status: "INCOMPLETE",
      }));
    });

    it("should normalize an invoice.payment_succeeded event", async () => {
      const mockEvent = {
        id: "evt_inv_paid",
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_123",
            customer: "cus_123",
            subscription: "sub_123",
            payment_intent: "pi_123",
            amount_due: 1000,
            amount_paid: 1000,
            amount_remaining: 0,
            currency: "usd",
            status: "paid",
            number: "INV-001",
            invoice_pdf: "pdf_url",
            hosted_invoice_url: "hosted_url",
            period_start: 1700000000,
            period_end: 1702600000,
            due_date: 1701000000,
            status_transitions: { paid_at: 1700500000 },
            attempt_count: 1,
            lines: { data: [] },
            metadata: { custom: "meta" },
          },
        },
      };
      stripeMock.webhooks.constructEvent.mockReturnValue(mockEvent);
      
      // Mock payment intent retrieval for card details
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        payment_method_types: ["card"],
        charges: {
          data: [{
            payment_method_details: { card: { last4: "4242" } },
          }],
        },
      });

      // Mock subscription retrieval for metadata
      stripeMock.subscriptions.retrieve.mockResolvedValue({
        metadata: { workspaceId: "ws_123" },
      });

      const result = await provider.verifyAndParseWebhook(mockRawBody, mockHeaders);

      expect(result).toEqual(expect.objectContaining({
        type: "INVOICE_PAID",
        providerInvoiceId: "in_123",
        amountPaid: 1000,
        status: "PAID",
        cardLast4: "4242",
        paymentMethodType: "card",
      }));
      expect(result?.metadata).toEqual({ workspaceId: "ws_123", custom: "meta" });
    });
  });
});
