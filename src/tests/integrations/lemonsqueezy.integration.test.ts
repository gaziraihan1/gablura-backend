import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getPaymentProvider } from "../../payment/provider.registry.js";
import { prisma } from "../../lib/prisma.js";
import { BILLING_CACHE } from "../../redis/redis.client.js";
import {
  createHmac,
} from "crypto";
import type {
  NormalisedSubscriptionEvent,
  NormalisedInvoiceEvent,
  NormalisedRefundEvent,
} from "../../payment/IpaymentProvider.js";

// ── Mock the payment provider registry ────────────────────────────────────────
vi.mock("../../payment/provider.registry.js", () => ({
  getPaymentProvider: vi.fn(),
}));

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    billingEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    plan: {
      findUnique: vi.fn(),
    },
    workspace: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    invoice: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../redis/redis.client.js", () => ({
  BILLING_CACHE: {
    invalidateWorkspace: vi.fn(),
  },
}));

vi.mock("../../lib/redis/cache.client.js", () => ({
  WorkspaceCache: {
    invalidateWorkspace: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock rate limiter (pass-through in tests) ────────────────────────────────
vi.mock("../../middleware/rateLimiter.js", () => ({
  rateLimitMiddleware: () => (req: any, res: any, next: any) => next(),
}));

// ── Mock billing webhook retry queue (no-op in tests) ───────────────────────
vi.mock("../../queue/index.js", () => ({
  addBillingWebhookRetryJob: vi.fn().mockResolvedValue(null),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "ls_test_webhook_secret";

function signBody(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

function makeLemonSqueezyWebhookBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

// Standard mock plan returned by prisma.plan.findUnique
const MOCK_PRO_PLAN = {
  id: "plan_pro",
  name: "PRO",
  maxMembersPerWs: 25,
  maxStorageMb: 10240,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  displayName: "PRO",
  stripeProductId: null,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
  maxFileSizeMb: 25,
  maxMeetingsPerMo: -1,
  maxProjects: -1,
  analyticsAccess: true,
  prioritySupport: false,
  apiAccess: false,
  customBranding: false,
  advancedReports: false,
  businessOnlyAccess: false,
  maxWorkspacesOwned: 3,
  monthlyPriceCents: 1999,
  yearlyPriceCents: 19990,
  active: true,
  sortOrder: 1,
};

const MOCK_FREE_PLAN = {
  id: "plan_free",
  name: "FREE",
  maxMembersPerWs: 5,
  maxStorageMb: 1024,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  displayName: "FREE",
  stripeProductId: null,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
  maxFileSizeMb: 5,
  maxMeetingsPerMo: 10,
  maxProjects: 3,
  analyticsAccess: false,
  prioritySupport: false,
  apiAccess: false,
  customBranding: false,
  advancedReports: false,
  businessOnlyAccess: false,
  maxWorkspacesOwned: 1,
  monthlyPriceCents: 0,
  yearlyPriceCents: 0,
  active: true,
  sortOrder: 0,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Lemon Squeezy Integration — Full Checkout-to-Webhook Flow", () => {
  const mockProvider = {
    name: "lemonsqueezy",
    verifyAndParseWebhook: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
      id: "billing_evt_1",
      providerEventId: "ls_test",
      processed: false,
    } as any);

    vi.mocked(prisma.subscription.upsert).mockResolvedValue({
      id: "sub_obj_123",
      workspaceId: "ws_123",
      stripeSubscriptionId: "ls_sub_123",
      stripeCustomerId: "ls_cust_123",
      status: "ACTIVE",
      planId: "plan_pro",
      billingCycle: "MONTHLY",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    } as any);

    vi.mocked(prisma.workspace.update).mockResolvedValue({
      id: "ws_123",
      slug: "test-workspace",
    } as any);

    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      id: "ws_123",
      slug: "test-workspace",
      ownerId: "owner_123",
    } as any);

    (vi.mocked(prisma.plan.findUnique) as any).mockImplementation(async (args: any) => {
      if (args.where.name === "FREE") return MOCK_FREE_PLAN as any;
      if (args.where.name === "PRO") return MOCK_PRO_PLAN as any;
      return null;
    });

    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
  });

  // =========================================================================
  // SUBSCRIPTION LIFECYCLE
  // =========================================================================

  describe("Subscription Lifecycle", () => {
    it("handles full lifecycle: created → updated → cancelled → expired", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      // ── Step 1: subscription_created ───────────────────────────────────────
      const createdEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_001_created",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_001",
        providerCustomerId: "ls_cust_001",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-01-01"),
        currentPeriodEnd: new Date("2026-02-01"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_123", ownerId: "owner_123" },
        raw: { id: "ls_sub_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(createdEvent);

      const res1 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ received: true });
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_123" },
          create: expect.objectContaining({
            stripeSubscriptionId: "ls_sub_001",
            status: "ACTIVE",
          }),
        }),
      );
      expect(prisma.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ws_123" },
          data: expect.objectContaining({ plan: "PRO" }),
        }),
      );

      // ── Step 2: subscription_updated ───────────────────────────────────────
      vi.clearAllMocks();
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_evt_2",
        providerEventId: "ls_sub_001_updated",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_123",
        slug: "test-workspace",
      } as any);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
      } as any);
      vi.mocked(prisma.subscription.upsert).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
      } as any);
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 } as any);
      (vi.mocked(prisma.plan.findUnique) as any).mockImplementation(async (args: any) => {
        if (args.where.name === "FREE") return MOCK_FREE_PLAN as any;
        if (args.where.name === "PRO") return MOCK_PRO_PLAN as any;
        return null;
      });

      const updatedEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_001_updated",
        type: "SUBSCRIPTION_UPDATED",
        providerSubscriptionId: "ls_sub_001",
        providerCustomerId: "ls_cust_001",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-02-01"),
        currentPeriodEnd: new Date("2026-03-01"),
        cancelAtPeriodEnd: true,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_123", ownerId: "owner_123" },
        raw: { id: "ls_sub_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(updatedEvent);

      const res2 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res2.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_123" },
          update: expect.objectContaining({
            cancelAtPeriodEnd: true,
          }),
        }),
      );

      // ── Step 3: subscription_cancelled ─────────────────────────────────────
      vi.clearAllMocks();
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_evt_3",
        providerEventId: "ls_sub_001_cancelled",
        processed: false,
      } as any);
      (vi.mocked(prisma.plan.findUnique) as any).mockImplementation(async (args: any) => {
        if (args.where.name === "FREE") return MOCK_FREE_PLAN as any;
        if (args.where.name === "PRO") return MOCK_PRO_PLAN as any;
        return null;
      });

      const cancelledEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_001_cancelled",
        type: "SUBSCRIPTION_CANCELED",
        providerSubscriptionId: "ls_sub_001",
        providerCustomerId: "ls_cust_001",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "CANCELED",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-02-01"),
        currentPeriodEnd: new Date("2026-03-01"),
        cancelAtPeriodEnd: false,
        canceledAt: new Date("2026-02-15"),
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_123", ownerId: "owner_123" },
        raw: { id: "ls_sub_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(cancelledEvent);

      const res3 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res3.status).toBe(200);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_123" },
          data: expect.objectContaining({ status: "CANCELED" }),
        }),
      );
      // Workspace should be downgraded to FREE
      expect(prisma.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ws_123" },
          data: expect.objectContaining({
            plan: "FREE",
            maxMembers: 5,
            maxStorage: 1024,
          }),
        }),
      );
      expect(BILLING_CACHE.invalidateWorkspace).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // TRIAL FLOW
  // =========================================================================

  describe("Trial Flow", () => {
    it("handles trial subscription: TRIALING → ACTIVE (trial ending)", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      // ── Step 1: subscription TRIALING ──────────────────────────────────────
      const trialEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_trial_001",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_trial",
        providerCustomerId: "ls_cust_trial",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "TRIALING",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-01-15"),
        currentPeriodEnd: new Date("2026-01-29"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: new Date("2026-01-15"),
        trialEnd: new Date("2026-01-29"),
        metadata: { workspaceId: "ws_456", ownerId: "owner_456" },
        raw: { id: "ls_sub_trial" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(trialEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_trial",
        providerEventId: "ls_trial_001",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_456",
        slug: "trial-workspace",
      } as any);

      const res1 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res1.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_456" },
          create: expect.objectContaining({
            status: "TRIALING",
          }),
        }),
      );

      // ── Step 2: trial ends → subscription ACTIVATED ────────────────────────
      vi.clearAllMocks();
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_trial_end",
        providerEventId: "ls_trial_002",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_456",
        slug: "trial-workspace",
      } as any);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        id: "sub_trial_obj",
        workspaceId: "ws_456",
      } as any);
      vi.mocked(prisma.subscription.upsert).mockResolvedValue({
        id: "sub_trial_obj",
        workspaceId: "ws_456",
      } as any);
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 } as any);
      (vi.mocked(prisma.plan.findUnique) as any).mockImplementation(async (args: any) => {
        if (args.where.name === "FREE") return MOCK_FREE_PLAN as any;
        if (args.where.name === "PRO") return MOCK_PRO_PLAN as any;
        return null;
      });

      const activatedEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_trial_002",
        type: "SUBSCRIPTION_ACTIVATED",
        providerSubscriptionId: "ls_sub_trial",
        providerCustomerId: "ls_cust_trial",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-01-29"),
        currentPeriodEnd: new Date("2026-02-29"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_456", ownerId: "owner_456" },
        raw: { id: "ls_sub_trial" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(activatedEvent);

      const res2 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res2.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_456" },
          update: expect.objectContaining({
            status: "ACTIVE",
          }),
        }),
      );
    });
  });

  // =========================================================================
  // PAYMENT EVENTS
  // =========================================================================

  describe("Payment Events", () => {
    it("processes INVOICE_PAID and creates payment record", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const invoiceEvent: NormalisedInvoiceEvent = {
        providerEventId: "ls_inv_paid_001",
        type: "INVOICE_PAID",
        providerInvoiceId: "ls_inv_001",
        providerCustomerId: "ls_cust_001",
        providerSubscriptionId: "ls_sub_001",
        providerPaymentId: "ls_pay_001",
        amountDue: 1999,
        amountPaid: 1999,
        amountRemaining: 0,
        currency: "usd",
        status: "PAID",
        invoiceNumber: "LS-INV-001",
        invoicePdfUrl: null,
        hostedInvoiceUrl: null,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        dueDate: null,
        paidAt: new Date("2026-01-15"),
        attemptCount: 1,
        paymentMethodType: "card",
        cardLast4: "4242",
        lineItems: [],
        metadata: { workspaceId: "ws_123", ownerId: "owner_123" },
        raw: { id: "ls_inv_paid_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(invoiceEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_inv_1",
        providerEventId: "ls_inv_paid_001",
        processed: false,
      } as any);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
      } as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(prisma.invoice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeInvoiceId: "ls_inv_001" },
          create: expect.objectContaining({
            status: "PAID",
            amountPaid: 1999,
          }),
        }),
      );
      expect(prisma.payment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripePaymentIntentId: "ls_pay_001" },
          create: expect.objectContaining({
            amount: 1999,
            status: "SUCCEEDED",
            paymentMethod: "card",
            last4: "4242",
          }),
        }),
      );
    });

    it("processes INVOICE_PAYMENT_FAILED and updates subscription to PAST_DUE", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const failedEvent: NormalisedInvoiceEvent = {
        providerEventId: "ls_inv_fail_001",
        type: "INVOICE_PAYMENT_FAILED",
        providerInvoiceId: "ls_inv_fail_001",
        providerCustomerId: "ls_cust_001",
        providerSubscriptionId: "ls_sub_001",
        providerPaymentId: null,
        amountDue: 1999,
        amountPaid: 0,
        amountRemaining: 1999,
        currency: "usd",
        status: "UNCOLLECTIBLE",
        invoiceNumber: null,
        invoicePdfUrl: null,
        hostedInvoiceUrl: null,
        periodStart: null,
        periodEnd: null,
        dueDate: null,
        paidAt: null,
        attemptCount: 1,
        paymentMethodType: null,
        cardLast4: null,
        lineItems: [],
        metadata: { workspaceId: "ws_123" },
        raw: { id: "ls_inv_fail_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(failedEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_inv_fail",
        providerEventId: "ls_inv_fail_001",
        processed: false,
      } as any);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
      } as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: "sub_obj_123" },
        data: { status: "PAST_DUE" },
      });
    });

    it("processes INVOICE_CREATED for new invoice", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const createdInvEvent: NormalisedInvoiceEvent = {
        providerEventId: "ls_inv_created_001",
        type: "INVOICE_CREATED",
        providerInvoiceId: "ls_inv_created_001",
        providerCustomerId: "ls_cust_001",
        providerSubscriptionId: "ls_sub_001",
        providerPaymentId: null,
        amountDue: 1999,
        amountPaid: 0,
        amountRemaining: 1999,
        currency: "usd",
        status: "OPEN",
        invoiceNumber: "LS-INV-002",
        invoicePdfUrl: null,
        hostedInvoiceUrl: null,
        periodStart: new Date("2026-02-01"),
        periodEnd: new Date("2026-03-01"),
        dueDate: null,
        paidAt: null,
        attemptCount: 0,
        paymentMethodType: null,
        cardLast4: null,
        lineItems: [],
        metadata: { workspaceId: "ws_123" },
        raw: { id: "ls_inv_created_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(createdInvEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_inv_created",
        providerEventId: "ls_inv_created_001",
        processed: false,
      } as any);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
      } as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(prisma.invoice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeInvoiceId: "ls_inv_created_001" },
          create: expect.objectContaining({
            status: "OPEN",
          }),
        }),
      );
    });
  });

  // =========================================================================
  // REFUND / ORDER EVENTS
  // =========================================================================

  describe("Refund Events", () => {
    it("processes REFUND_CREATED and marks invoice + payment refunded", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const refundEvent: NormalisedRefundEvent = {
        providerEventId: "ls_refund_001",
        type: "REFUND_CREATED",
        providerRefundId: "ls_ref_001",
        providerTransactionId: "ls_txn_001",
        providerSubscriptionId: "ls_sub_001",
        providerCustomerId: "ls_cust_001",
        action: "refund",
        status: "approved",
        amount: 1999,
        currency: "usd",
        metadata: { workspaceId: "ws_123" },
        raw: { id: "ls_refund_001" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(refundEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_refund",
        providerEventId: "ls_refund_001",
        processed: false,
      } as any);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: "sub_obj_123",
        workspaceId: "ws_123",
        status: "ACTIVE",
      } as any);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv_obj_123",
        workspaceId: "ws_123",
        amountPaid: 1999,
        amountRefunded: 0,
        status: "PAID",
      } as any);
      vi.mocked(prisma.payment.findFirst).mockResolvedValue({
        id: "pay_obj_123",
        amount: 1999,
        refundedAmount: 0,
        status: "SUCCEEDED",
      } as any);
      vi.mocked(prisma.plan.findUnique).mockResolvedValue(MOCK_FREE_PLAN as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(BILLING_CACHE.invalidateWorkspace).toHaveBeenCalled();
    });

    it("processes REFUND_UPDATED event", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const refundUpdatedEvent: NormalisedRefundEvent = {
        providerEventId: "ls_refund_002",
        type: "REFUND_UPDATED",
        providerRefundId: "ls_ref_002",
        providerTransactionId: "ls_txn_002",
        providerSubscriptionId: null,
        providerCustomerId: "ls_cust_001",
        action: "credit",
        status: "approved",
        amount: 999,
        currency: "usd",
        metadata: {},
        raw: { id: "ls_refund_002" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(refundUpdatedEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_refund_upd",
        providerEventId: "ls_refund_002",
        processed: false,
      } as any);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv_obj_2",
        workspaceId: "ws_123",
        amountPaid: 1999,
        amountRefunded: 0,
        status: "PAID",
      } as any);
      vi.mocked(prisma.payment.findFirst).mockResolvedValue({
        id: "pay_obj_2",
        amount: 1999,
        refundedAmount: 0,
        status: "SUCCEEDED",
      } as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // IDEMPOTENCY
  // =========================================================================

  describe("Idempotency", () => {
    it("does not reprocess an already-processed event", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const event: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_idempotent",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_999",
        providerCustomerId: "ls_cust_999",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_123" },
        raw: { id: "ls_sub_idempotent" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValue(event);

      vi.mocked(prisma.billingEvent.findUnique).mockResolvedValue({
        providerEventId: "ls_sub_idempotent",
        processed: true,
      } as any);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      // Should NOT upsert subscription or update workspace
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // ERROR HANDLING
  // =========================================================================

  describe("Error Handling", () => {
    it("returns 400 when webhook signature verification fails", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      mockProvider.verifyAndParseWebhook.mockRejectedValue(
        new Error("[LemonSqueezyProvider] Invalid webhook signature"),
      );

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Webhook verification failed" });
    });

    it("returns 200 when event is null (ignored event)", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      mockProvider.verifyAndParseWebhook.mockResolvedValue(null);

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it("returns 500 and records error when processing fails", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      const event: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_fail",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_fail",
        providerCustomerId: "ls_cust_fail",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_123" },
        raw: { id: "ls_sub_fail" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValue(event);

      vi.mocked(prisma.billingEvent.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_fail",
        providerEventId: "ls_sub_fail",
        processed: false,
      } as any);

      // Make plan lookup fail to trigger processing error
      vi.mocked(prisma.plan.findUnique).mockRejectedValue(
        new Error("Database connection lost"),
      );

      const response = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Processing failed" });
      expect(prisma.billingEvent.update).toHaveBeenCalledWith({
        where: { id: "billing_fail" },
        data: { error: "Database connection lost" },
      });
    });
  });

  // =========================================================================
  // PAUSE / RESUME
  // =========================================================================

  describe("Pause and Resume", () => {
    it("handles SUBSCRIPTION_PAUSED → SUBSCRIPTION_RESUMED", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      // ── Pause ─────────────────────────────────────────────────────────────
      const pauseEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_paused",
        type: "SUBSCRIPTION_PAUSED",
        providerSubscriptionId: "ls_sub_pause",
        providerCustomerId: "ls_cust_pause",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "PAUSED",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-01-01"),
        currentPeriodEnd: new Date("2026-02-01"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_789" },
        raw: { id: "ls_sub_paused" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(pauseEvent);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_pause",
        providerEventId: "ls_sub_paused",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_789",
        slug: "pause-ws",
      } as any);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

      const res1 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res1.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_789" },
          update: expect.objectContaining({ status: "PAUSED" }),
        }),
      );

      // ── Resume ─────────────────────────────────────────────────────────────
      vi.clearAllMocks();
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      vi.mocked(prisma.subscription.upsert).mockResolvedValue({
        id: "sub_pause_obj",
        workspaceId: "ws_789",
      } as any);
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_resume",
        providerEventId: "ls_sub_resumed",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_789",
        slug: "pause-ws",
      } as any);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

      const resumeEvent: NormalisedSubscriptionEvent = {
        providerEventId: "ls_sub_resumed",
        type: "SUBSCRIPTION_RESUMED",
        providerSubscriptionId: "ls_sub_pause",
        providerCustomerId: "ls_cust_pause",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date("2026-02-01"),
        currentPeriodEnd: new Date("2026-03-01"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_789" },
        raw: { id: "ls_sub_resumed" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(resumeEvent);

      const res2 = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(res2.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_789" },
          update: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });
  });

  // =========================================================================
  // MULTI-WORKSPACE ISOLATION
  // =========================================================================

  describe("Multi-Workspace Isolation", () => {
    it("processes events for different workspaces independently", async () => {
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);

      // ── Event for workspace A ──────────────────────────────────────────────
      const eventA: NormalisedSubscriptionEvent = {
        providerEventId: "ls_ws_a",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_a",
        providerCustomerId: "ls_cust_a",
        providerPriceId: "variant_pro_mo",
        planName: "PRO",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_A", ownerId: "owner_A" },
        raw: { id: "ls_ws_a" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(eventA);

      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_a",
        providerEventId: "ls_ws_a",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_A",
        slug: "workspace-a",
      } as any);

      const resA = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(resA.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_A" },
        }),
      );

      // ── Event for workspace B ──────────────────────────────────────────────
      vi.clearAllMocks();
      vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
      vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
        id: "billing_b",
        providerEventId: "ls_ws_b",
        processed: false,
      } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws_B",
        slug: "workspace-b",
      } as any);
      vi.mocked(prisma.subscription.upsert).mockResolvedValue({
        id: "sub_obj_b",
        workspaceId: "ws_B",
      } as any);
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 } as any);
      (vi.mocked(prisma.plan.findUnique) as any).mockImplementation(async (args: any) => {
        if (args.where.name === "FREE") return MOCK_FREE_PLAN as any;
        if (args.where.name === "BUSINESS") return { ...MOCK_PRO_PLAN, name: "BUSINESS", maxMembersPerWs: -1, maxStorageMb: 102400 } as any;
        return null;
      });

      const eventB: NormalisedSubscriptionEvent = {
        providerEventId: "ls_ws_b",
        type: "SUBSCRIPTION_CREATED",
        providerSubscriptionId: "ls_sub_b",
        providerCustomerId: "ls_cust_b",
        providerPriceId: "variant_biz_mo",
        planName: "BUSINESS",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: { workspaceId: "ws_B", ownerId: "owner_B" },
        raw: { id: "ls_ws_b" },
      };
      mockProvider.verifyAndParseWebhook.mockResolvedValueOnce(eventB);

      const resB = await request(app)
        .post("/webhooks/billing")
        .send({ dummy: true });

      expect(resB.status).toBe(200);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws_B" },
        }),
      );
      // Workspace A should not be touched by workspace B's event
      expect(prisma.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ws_B" },
          data: expect.objectContaining({ plan: "BUSINESS" }),
        }),
      );
    });
  });
});
