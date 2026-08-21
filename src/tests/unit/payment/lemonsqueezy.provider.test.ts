import { describe, it, expect, vi, beforeEach } from "vitest";
import { LemonSqueezyProvider } from "../../../payment/providers/lemonsqueezy/lemonsqueezy.provider.js";
import { CacheClient, CACHE_KEYS, ExternalApiCache } from "../../../lib/redis/cache.client.js";
import { createHmac } from "crypto";

// ── Mock the Lemon Squeezy config module ──────────────────────────────────────
vi.mock("../../../modules/billing/config/lemonsqueezy.js", () => {
  const mockFns = {
    createCustomer: vi.fn(),
    createCheckout: vi.fn(),
    getCustomer: vi.fn(),
    getSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
  };

  return {
    setupLemonSqueezy: vi.fn(),
    getLemonSqueezyStoreId: vi.fn(() => "12345"),
    getLemonSqueezyWebhookSecret: vi.fn(() => "ls_webhook_secret_123"),
    LEMONSQUEEZY_VARIANT_IDS: {
      PRO: { monthly: "variant_pro_mo", yearly: "variant_pro_yr" },
      BUSINESS: { monthly: "variant_biz_mo", yearly: "variant_biz_yr" },
    },
    LEMONSQUEEZY_VARIANT_TO_PLAN: new Map([
      ["variant_pro_mo", { planName: "PRO", cycle: "MONTHLY" }],
      ["variant_pro_yr", { planName: "PRO", cycle: "YEARLY" }],
      ["variant_biz_mo", { planName: "BUSINESS", cycle: "MONTHLY" }],
      ["variant_biz_yr", { planName: "BUSINESS", cycle: "YEARLY" }],
    ]),
    resolveLemonSqueezyVariantId: vi.fn(
      (planName: string, billingCycle: string) => {
        const map: Record<string, Record<string, string>> = {
          PRO: { MONTHLY: "variant_pro_mo", YEARLY: "variant_pro_yr" },
          BUSINESS: {
            MONTHLY: "variant_biz_mo",
            YEARLY: "variant_biz_yr",
          },
        };
        return map[planName]?.[billingCycle] ?? "";
      },
    ),
    ...mockFns,
  };
});

// Import after mocking
import {
  setupLemonSqueezy,
  getLemonSqueezyStoreId,
  getLemonSqueezyWebhookSecret,
  createCustomer as lsCreateCustomer,
  createCheckout as lsCreateCheckout,
  getCustomer as lsGetCustomer,
  getSubscription as lsGetSubscription,
  updateSubscription as lsUpdateSubscription,
  cancelSubscription as lsCancelSubscription,
} from "../../../modules/billing/config/lemonsqueezy.js";

describe("LemonSqueezyProvider", () => {
  let provider: LemonSqueezyProvider;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear common cache keys used in tests to avoid leakage between tests
    await CacheClient.delete(
      CACHE_KEYS.lemonSqueezyCustomer("test@example.com"),
      "api:lemonsqueezy:portal:12345",
    );

    process.env.LEMONSQUEEZY_API_KEY = "ls_test_key";
    process.env.LEMONSQUEEZY_STORE_ID = "12345";
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "ls_webhook_secret_123";
    process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY = "variant_pro_mo";
    process.env.LEMONSQUEEZY_VARIANT_PRO_YEARLY = "variant_pro_yr";
    process.env.LEMONSQUEEZY_VARIANT_BUSINESS_MONTHLY = "variant_biz_mo";
    process.env.LEMONSQUEEZY_VARIANT_BUSINESS_YEARLY = "variant_biz_yr";

    provider = new LemonSqueezyProvider();
  });

  describe("createCustomer", () => {
    it("should create a customer using the Lemon Squeezy SDK", async () => {
      vi.mocked(lsCreateCustomer).mockResolvedValue({
        statusCode: 201,
        data: {
          data: { id: "12345", attributes: { email: "test@example.com" } },
        } as any,
        error: null,
      });

      const result = await provider.createCustomer({
        email: "test@example.com",
        name: "Test User",
        metadata: { foo: "bar" },
      });

      expect(lsCreateCustomer).toHaveBeenCalledWith("12345", {
        name: "Test User",
        email: "test@example.com",
      });
      expect(result).toEqual({ providerCustomerId: "12345" });
    });

    it("should return cached customer if already exists", async () => {
      vi.mocked(lsCreateCustomer).mockResolvedValue({
        statusCode: 201,
        data: {
          data: { id: "99999", attributes: { email: "test@example.com" } },
        } as any,
        error: null,
      });

      const email = "test@example.com";

      // First call - hits API
      await provider.createCustomer({
        email,
        name: "User",
        metadata: {},
      });
      expect(lsCreateCustomer).toHaveBeenCalledTimes(1);

      // Second call - hits cache
      const result = await provider.createCustomer({
        email,
        name: "User",
        metadata: {},
      });
      expect(lsCreateCustomer).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ providerCustomerId: "99999" });
    });

    it("should throw error when SDK returns an error", async () => {
      vi.mocked(lsCreateCustomer).mockResolvedValue({
        statusCode: 422,
        data: null,
        error: new Error("Validation failed"),
      });

      await expect(
        provider.createCustomer({
          email: "test@example.com",
          name: "User",
          metadata: {},
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Failed to create customer");
    });

    it("should throw error when no customer ID is returned", async () => {
      vi.mocked(lsCreateCustomer).mockResolvedValue({
        statusCode: 201,
        data: { data: null } as any,
        error: null,
      });

      await expect(
        provider.createCustomer({
          email: "test@example.com",
          name: "User",
          metadata: {},
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] No customer ID returned");
    });
  });

  describe("createCheckoutSession", () => {
    it("should create a checkout session with correct params", async () => {
      vi.mocked(lsCreateCheckout).mockResolvedValue({
        statusCode: 201,
        data: {
          data: {
            attributes: {
              url: "https://checkout.lemonsqueezy.com/abc123",
            },
          },
        } as any,
        error: null,
      });

      const result = await provider.createCheckoutSession({
        providerCustomerId: "12345",
        planName: "PRO",
        billingCycle: "MONTHLY",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        workspaceId: "ws_123",
        ownerId: "user_123",
        trialDays: 14,
        metadata: { some: "meta" },
      });

      expect(lsCreateCheckout).toHaveBeenCalledWith(
        "12345",
        "variant_pro_mo",
        expect.objectContaining({
          productOptions: expect.objectContaining({
            redirectUrl: "https://example.com/success",
            enabledVariants: ["variant_pro_mo" as unknown as number],
          }),
          checkoutOptions: expect.objectContaining({
            skipTrial: false, // trialDays > 0
          }),
          checkoutData: expect.objectContaining({
            custom: {
              workspaceId: "ws_123",
              ownerId: "user_123",
              planName: "PRO",
              billingCycle: "MONTHLY",
            },
          }),
        }),
      );
      expect(result).toEqual({
        url: "https://checkout.lemonsqueezy.com/abc123",
      });
    });

    it("should set skipTrial to true when trialDays is 0", async () => {
      vi.mocked(lsCreateCheckout).mockResolvedValue({
        statusCode: 201,
        data: {
          data: {
            attributes: { url: "https://checkout.lemonsqueezy.com/xyz" },
          },
        } as any,
        error: null,
      });

      await provider.createCheckoutSession({
        providerCustomerId: "12345",
        planName: "PRO",
        billingCycle: "MONTHLY",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        workspaceId: "ws_123",
        ownerId: "user_123",
        trialDays: 0,
        metadata: {},
      });

      expect(lsCreateCheckout).toHaveBeenCalledWith(
        "12345",
        "variant_pro_mo",
        expect.objectContaining({
          checkoutOptions: expect.objectContaining({
            skipTrial: true,
          }),
        }),
      );
    });

    it("should use yearly variant for YEARLY billing cycle", async () => {
      vi.mocked(lsCreateCheckout).mockResolvedValue({
        statusCode: 201,
        data: {
          data: {
            attributes: { url: "https://checkout.lemonsqueezy.com/yr" },
          },
        } as any,
        error: null,
      });

      await provider.createCheckoutSession({
        providerCustomerId: "12345",
        planName: "PRO",
        billingCycle: "YEARLY",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        workspaceId: "ws_123",
        ownerId: "user_123",
        metadata: {},
      });

      expect(lsCreateCheckout).toHaveBeenCalledWith(
        "12345",
        "variant_pro_yr",
        expect.anything(),
      );
    });

    it("should throw error if no checkout URL returned", async () => {
      vi.mocked(lsCreateCheckout).mockResolvedValue({
        statusCode: 201,
        data: { data: { attributes: { url: null } } } as any,
        error: null,
      });

      await expect(
        provider.createCheckoutSession({
          providerCustomerId: "12345",
          planName: "PRO",
          billingCycle: "MONTHLY",
          successUrl: "ok",
          cancelUrl: "cancel",
          workspaceId: "ws",
          ownerId: "u",
          metadata: {},
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] No checkout URL returned");
    });

    it("should throw error when SDK returns an error", async () => {
      vi.mocked(lsCreateCheckout).mockResolvedValue({
        statusCode: 422,
        data: null,
        error: new Error("Invalid variant"),
      });

      await expect(
        provider.createCheckoutSession({
          providerCustomerId: "12345",
          planName: "PRO",
          billingCycle: "MONTHLY",
          successUrl: "ok",
          cancelUrl: "cancel",
          workspaceId: "ws",
          ownerId: "u",
          metadata: {},
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Failed to create checkout");
    });
  });

  describe("createPortalSession", () => {
    it("should create a portal session", async () => {
      vi.mocked(lsGetCustomer).mockResolvedValue({
        statusCode: 200,
        data: {
          data: {
            attributes: {
              urls: {
                customer_portal:
                  "https://my-store.lemonsqueezy.com/billing?expires=123&signature=abc",
              },
            },
          },
        } as any,
        error: null,
      });

      const result = await provider.createPortalSession({
        providerCustomerId: "12345",
        returnUrl: "https://example.com/return",
      });

      expect(lsGetCustomer).toHaveBeenCalledWith(12345);
      expect(result).toEqual({
        url: "https://my-store.lemonsqueezy.com/billing?expires=123&signature=abc",
      });
    });

    it("should throw error if no portal URL available", async () => {
      vi.mocked(lsGetCustomer).mockResolvedValue({
        statusCode: 200,
        data: {
          data: {
            attributes: { urls: { customer_portal: null } },
          },
        } as any,
        error: null,
      });

      await expect(
        provider.createPortalSession({
          providerCustomerId: "12345",
          returnUrl: "https://example.com/return",
        }),
      ).rejects.toThrow(
        "[LemonSqueezyProvider] No customer portal URL available",
      );
    });
  });

  describe("changePlan", () => {
    it("should update subscription to a new variant (upgrade)", async () => {
      vi.mocked(lsGetSubscription).mockResolvedValue({
        statusCode: 200,
        data: { data: { id: 456 } } as any,
        error: null,
      });

      vi.mocked(lsUpdateSubscription).mockResolvedValue({
        statusCode: 200,
        data: { data: { id: 456 } } as any,
        error: null,
      });

      await provider.changePlan({
        providerSubscriptionId: "456",
        newProviderPriceId: "variant_pro_yr",
        isUpgrade: true,
        metadata: { reason: "upgrade" },
      });

      expect(lsGetSubscription).toHaveBeenCalledWith(456);
      expect(lsUpdateSubscription).toHaveBeenCalledWith(456, {
        variantId: "variant_pro_yr" as unknown as number,
        invoiceImmediately: true,
      });
    });

    it("should use invoiceImmediately: false for downgrades", async () => {
      vi.mocked(lsGetSubscription).mockResolvedValue({
        statusCode: 200,
        data: { data: { id: 789 } } as any,
        error: null,
      });

      vi.mocked(lsUpdateSubscription).mockResolvedValue({
        statusCode: 200,
        data: { data: { id: 789 } } as any,
        error: null,
      });

      await provider.changePlan({
        providerSubscriptionId: "789",
        newProviderPriceId: "variant_pro_mo",
        isUpgrade: false,
        metadata: { reason: "downgrade" },
      });

      expect(lsUpdateSubscription).toHaveBeenCalledWith(789, {
        variantId: "variant_pro_mo" as unknown as number,
        invoiceImmediately: false,
      });
    });

    it("should throw error when subscription not found", async () => {
      vi.mocked(lsGetSubscription).mockResolvedValue({
        statusCode: 404,
        data: null,
        error: new Error("Not found"),
      });

      await expect(
        provider.changePlan({
          providerSubscriptionId: "nonexistent",
          newProviderPriceId: "variant_pro_yr",
          isUpgrade: true,
          metadata: {},
        }),
      ).rejects.toThrow();
    });

    it("should throw error when SDK update fails", async () => {
      vi.mocked(lsGetSubscription).mockResolvedValue({
        statusCode: 200,
        data: { data: { id: 456 } } as any,
        error: null,
      });

      vi.mocked(lsUpdateSubscription).mockResolvedValue({
        statusCode: 422,
        data: null,
        error: new Error("Invalid variant"),
      });

      await expect(
        provider.changePlan({
          providerSubscriptionId: "sub_123",
          newProviderPriceId: "variant_pro_yr",
          isUpgrade: true,
          metadata: {},
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Failed to update subscription");
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription immediately", async () => {
      vi.mocked(lsCancelSubscription).mockResolvedValue({
        statusCode: 200,
        data: {
          data: {
            id: 456,
            attributes: { cancelled: true, status: "cancelled" },
          },
        } as any,
        error: null,
      });

      await provider.cancelSubscription({
        providerSubscriptionId: "456",
        immediately: true,
      });

      expect(lsCancelSubscription).toHaveBeenCalledWith(456);
    });

    it("should cancel at period end (grace period)", async () => {
      vi.mocked(lsCancelSubscription).mockResolvedValue({
        statusCode: 200,
        data: {
          data: {
            id: 789,
            attributes: { cancelled: true, status: "cancelled" },
          },
        } as any,
        error: null,
      });

      await provider.cancelSubscription({
        providerSubscriptionId: "789",
        immediately: false,
        reason: "too expensive",
      });

      expect(lsCancelSubscription).toHaveBeenCalledWith(789);
    });

    it("should throw error when SDK cancel fails", async () => {
      vi.mocked(lsCancelSubscription).mockResolvedValue({
        statusCode: 422,
        data: null,
        error: new Error("Cannot cancel"),
      });

      await expect(
        provider.cancelSubscription({
          providerSubscriptionId: "456",
          immediately: true,
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Failed to cancel subscription");
    });
  });

  describe("reactivateSubscription", () => {
    it("should set cancelled=false to reactivate subscription", async () => {
      vi.mocked(lsUpdateSubscription).mockResolvedValue({
        statusCode: 200,
        data: {
          data: {
            id: 456,
            attributes: { cancelled: false, status: "active" },
          },
        } as any,
        error: null,
      });

      await provider.reactivateSubscription({
        providerSubscriptionId: "456",
      });

      expect(lsUpdateSubscription).toHaveBeenCalledWith(456, {
        cancelled: false,
      });
    });

    it("should throw error when SDK reactivation fails", async () => {
      vi.mocked(lsUpdateSubscription).mockResolvedValue({
        statusCode: 422,
        data: null,
        error: new Error("Subscription expired"),
      });

      await expect(
        provider.reactivateSubscription({
          providerSubscriptionId: "456",
        }),
      ).rejects.toThrow(
        "[LemonSqueezyProvider] Failed to reactivate subscription",
      );
    });
  });

  describe("verifyAndParseWebhook", () => {
    // Helper to create a signed webhook body
    function signBody(body: string, secret: string): string {
      return createHmac("sha256", secret).update(body).digest("hex");
    }

    const WEBHOOK_SECRET = "ls_webhook_secret_123";

    it("should throw error if signature is missing", async () => {
      await expect(
        provider.verifyAndParseWebhook(Buffer.from("{}"), {}),
      ).rejects.toThrow("[LemonSqueezyProvider] Missing signature");
    });

    it("should throw error if signature is invalid", async () => {
      const body = JSON.stringify({
        meta: { event_name: "subscription_created" },
      });
      const badSignature = "invalid_signature_hex";

      await expect(
        provider.verifyAndParseWebhook(Buffer.from(body), {
          "x-signature": badSignature,
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Invalid webhook signature");
    });

    it("should reject non-hex signatures (security: empty buffer bypass)", async () => {
      const body = JSON.stringify({
        meta: { event_name: "subscription_created" },
      });

      // These non-hex strings would produce empty Buffers via Buffer.from(s, 'hex'),
      // which previously could pass timingSafeEqual against another empty buffer.
      // Empty string "" is caught earlier by the !sigStr check ("Missing signature").
      for (const badSig of ["not-hex", "zzzzzzz", ":::", "abcdef1234"]) {
        await expect(
          provider.verifyAndParseWebhook(Buffer.from(body), {
            "x-signature": badSig,
          }),
        ).rejects.toThrow("[LemonSqueezyProvider] Invalid webhook signature");
      }
    });

    it("should throw error for invalid JSON payload", async () => {
      const body = "not valid json";
      const signature = signBody(body, WEBHOOK_SECRET);

      await expect(
        provider.verifyAndParseWebhook(Buffer.from(body), {
          "x-signature": signature,
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Invalid JSON payload");
    });

    it("should throw error if event_name is missing", async () => {
      const body = JSON.stringify({ meta: {} });
      const signature = signBody(body, WEBHOOK_SECRET);

      await expect(
        provider.verifyAndParseWebhook(Buffer.from(body), {
          "x-signature": signature,
        }),
      ).rejects.toThrow("[LemonSqueezyProvider] Missing event_name");
    });

    it("should return null for ignored event types", async () => {
      const body = JSON.stringify({
        meta: { event_name: "customer_updated", custom_data: {} },
        type: "customers",
        id: "1",
        attributes: {},
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });
      expect(result).toBeNull();
    });

    it("should normalize a subscription_created event", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_created",
          custom_data: { workspaceId: "ws_123", ownerId: "user_123" },
        },
        type: "subscriptions",
        id: "100",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 111,
          order_item_id: 222,
          product_id: 333,
          variant_id: 444,
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "active",
          status_formatted: "Active",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 1,
            subscription_id: 100,
            price_id: 444,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-02-01T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_CREATED",
          providerEventId: expect.stringContaining("ls_100_"),
          providerSubscriptionId: "100",
          providerCustomerId: "56789",
          planName: "PRO",
          status: "ACTIVE",
          billingCycle: "MONTHLY",
          metadata: {
            workspaceId: "ws_123",
            ownerId: "user_123",
          },
        }),
      );
    });

    it("should normalize a subscription_cancelled event", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_cancelled",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "200",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 333,
          order_item_id: 444,
          product_id: 555,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "cancelled",
          status_formatted: "Cancelled",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: true,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 2,
            subscription_id: 200,
            price_id: 666,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: null,
          ends_at: "2026-03-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-15T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_CANCELED",
          providerSubscriptionId: "200",
          planName: "PRO",
          status: "CANCELED",
          cancelAtPeriodEnd: true,
          canceledAt: new Date("2026-03-01T00:00:00Z"),
        }),
      );
    });

    it("should normalize a subscription_paused event", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_paused",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "300",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 555,
          order_item_id: 666,
          product_id: 777,
          variant_id: 888,
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "paused",
          status_formatted: "Paused",
          card_brand: "",
          card_last_four: "",
          payment_processor: "stripe",
          pause: { mode: "void", resumes_at: null },
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 3,
            subscription_id: 300,
            price_id: 888,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-02-01T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-15T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_PAUSED",
          providerSubscriptionId: "300",
          status: "PAUSED",
        }),
      );
    });

    it("should normalize a subscription_resumed event as ACTIVATED", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_resumed",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "400",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 777,
          order_item_id: 888,
          product_id: 999,
          variant_id: 1000,
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "active",
          status_formatted: "Active",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 4,
            subscription_id: 400,
            price_id: 1000,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-03-01T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-20T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_ACTIVATED",
          providerSubscriptionId: "400",
          status: "ACTIVE",
        }),
      );
    });

    it("should normalize a subscription.on_trial event as TRIALING", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_created",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "500",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 1000,
          order_item_id: 1001,
          product_id: 1002,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "on_trial",
          status_formatted: "On trial",
          card_brand: "",
          card_last_four: "",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: "2026-02-14T00:00:00Z",
          billing_anchor: null,
          first_subscription_item: null,
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-02-14T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_CREATED",
          status: "TRIALING",
          trialStart: new Date("2026-01-01T00:00:00Z"),
          trialEnd: new Date("2026-02-14T00:00:00Z"),
        }),
      );
    });

    it("should normalize a subscription_payment_success as INVOICE_PAID", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_payment_success",
          custom_data: { workspaceId: "ws_123", ownerId: "user_123" },
        },
        type: "subscriptions",
        id: "600",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 1111,
          order_item_id: 1112,
          product_id: 1113,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "active",
          status_formatted: "Active",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 5,
            subscription_id: 600,
            price_id: 1114,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-03-01T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "INVOICE_PAID",
          providerSubscriptionId: "600",
          providerCustomerId: "56789",
          status: "PAID",
          paymentMethodType: "stripe",
          cardLast4: "4242",
          metadata: {
            workspaceId: "ws_123",
            ownerId: "user_123",
          },
        }),
      );
    });

    it("should normalize a subscription_payment_failed as INVOICE_PAYMENT_FAILED", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_payment_failed",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "700",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 2222,
          order_item_id: 2223,
          product_id: 2224,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "past_due",
          status_formatted: "Past due",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 6,
            subscription_id: 700,
            price_id: 2225,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-02-14T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "INVOICE_PAYMENT_FAILED",
          providerSubscriptionId: "700",
          status: "UNCOLLECTIBLE",
        }),
      );
    });

    it("should normalize an order_created event as INVOICE_CREATED", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "order_created",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "orders",
        id: "ord_100",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          identifier: "ord_abc123",
          order_number: 42,
          user_name: "Test User",
          user_email: "test@example.com",
          currency: "USD",
          currency_rate: "1",
          subtotal: 1999,
          discount_total: 0,
          tax: 0,
          total: 1999,
          refund_total: 0,
          subtotal_usd: 1999,
          discount_total_usd: 0,
          tax_usd: 0,
          total_usd: 1999,
          refund_total_usd: 0,
          created_at: "2026-01-15T12:00:00Z",
          updated_at: "2026-01-15T12:00:00Z",
          test_mode: false,
          status: "paid",
          status_formatted: "Paid",
          refund_url: null,
          order_number_formatted: "#42",
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "INVOICE_CREATED",
          providerInvoiceId: "ord_abc123",
          providerCustomerId: "56789",
          amountDue: 1999,
          amountPaid: 1999,
          currency: "usd",
          status: "PAID",
          invoiceNumber: "#42",
        }),
      );
    });

    it("should normalize an order_refunded event as REFUND_CREATED", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "order_refunded",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "orders",
        id: "ord_200",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          identifier: "ord_xyz456",
          order_number: 43,
          user_name: "Test User",
          user_email: "test@example.com",
          currency: "USD",
          currency_rate: "1",
          subtotal: 1999,
          discount_total: 0,
          tax: 0,
          total: 1999,
          refund_total: 1999,
          subtotal_usd: 1999,
          discount_total_usd: 0,
          tax_usd: 0,
          total_usd: 1999,
          refund_total_usd: 1999,
          created_at: "2026-01-20T12:00:00Z",
          updated_at: "2026-01-20T12:00:00Z",
          test_mode: false,
          status: "refunded",
          status_formatted: "Refunded",
          refund_url: "https://ls.example.com/refund",
          order_number_formatted: "#43",
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "REFUND_CREATED",
          providerRefundId: expect.stringContaining("ls_refund_"),
          providerTransactionId: "ord_xyz456",
          providerCustomerId: "56789",
          action: "refund",
          status: "approved",
          amount: 1999,
          currency: "usd",
        }),
      );
    });

    it("should handle subscription_expired as SUBSCRIPTION_CANCELED", async () => {
      const body = JSON.stringify({
        meta: {
          event_name: "subscription_expired",
          custom_data: { workspaceId: "ws_123" },
        },
        type: "subscriptions",
        id: "800",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 3333,
          order_item_id: 3334,
          product_id: 3335,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "expired",
          status_formatted: "Expired",
          card_brand: "",
          card_last_four: "",
          payment_processor: "stripe",
          pause: null,
          cancelled: true,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: null,
          urls: {
            update_payment_method: "",
            customer_portal: "",
            customer_portal_update_subscription: null,
          },
          renews_at: null,
          ends_at: "2026-02-15T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-15T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_CANCELED",
          providerSubscriptionId: "800",
          status: "CANCELED",
          canceledAt: new Date("2026-02-15T00:00:00Z"),
        }),
      );
    });

    it("should handle subscription with missing custom_data gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const body = JSON.stringify({
        meta: {
          event_name: "subscription_created",
          custom_data: {}, // missing workspaceId
        },
        type: "subscriptions",
        id: "900",
        attributes: {
          store_id: 12345,
          customer_id: 56789,
          order_id: 4444,
          order_item_id: 4445,
          product_id: 4446,
          variant_id: "variant_pro_mo",
          product_name: "Focura PRO",
          variant_name: "Monthly",
          user_name: "Test User",
          user_email: "test@example.com",
          status: "active",
          status_formatted: "Active",
          card_brand: "visa",
          card_last_four: "4242",
          payment_processor: "stripe",
          pause: null,
          cancelled: false,
          trial_ends_at: null,
          billing_anchor: null,
          first_subscription_item: {
            id: 7,
            subscription_id: 900,
            price_id: 4447,
            quantity: 1,
          },
          urls: {
            update_payment_method: "https://ls.example.com/pay",
            customer_portal: "https://ls.example.com/billing",
            customer_portal_update_subscription: null,
          },
          renews_at: "2026-03-01T00:00:00Z",
          ends_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          test_mode: false,
        },
      });
      const signature = signBody(body, WEBHOOK_SECRET);

      const result = await provider.verifyAndParseWebhook(Buffer.from(body), {
        "x-signature": signature,
      });

      // Should still produce a valid event with empty metadata
      expect(result).toEqual(
        expect.objectContaining({
          type: "SUBSCRIPTION_CREATED",
          providerSubscriptionId: "900",
          metadata: {},
        }),
      );

      // Should log the missing workspaceId
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing workspaceId"),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("provider properties", () => {
    it("should have the correct provider name", () => {
      expect(provider.name).toBe("lemonsqueezy");
    });

    it("should call setupLemonSqueezy on construction", () => {
      expect(setupLemonSqueezy).toHaveBeenCalled();
    });
  });
});
