import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getPaymentProvider } from "../../payment/provider.registry.js";
import { prisma } from "../../lib/prisma.js";
import { BILLING_CACHE } from "../../redis/redis.client.js";
import type { NormalisedSubscriptionEvent, NormalisedInvoiceEvent } from "../../payment/IpaymentProvider.js";

// Mock the payment provider registry to inject a fake provider
vi.mock("../../payment/provider.registry.js", () => ({
  getPaymentProvider: vi.fn(),
}));

// Mock Prisma and cache to avoid real DB interactions
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    billingEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
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
    },
    payment: {
      upsert: vi.fn(),
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

describe("Stripe Webhook Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock billing event upsert to return a valid object with an id
    vi.mocked(prisma.billingEvent.upsert).mockResolvedValue({
      id: "evt_test_123",
      providerEventId: "evt_test_123",
      processed: false,
    } as any);

    // Mock subscription upsert to return a valid subscription
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({
      id: "sub_obj_123",
      workspaceId: "ws_123",
      stripeSubscriptionId: "sub_123",
      status: "ACTIVE",
    } as any);

    // Mock workspace update to return a valid workspace with slug
    vi.mocked(prisma.workspace.update).mockResolvedValue({
      id: "ws_123",
      slug: "test-workspace",
    } as any);

    // Mock a basic plan for all tests
    vi.mocked(prisma.plan.findUnique).mockResolvedValue({
      id: "plan_pro",
      name: "PRO",
      maxMembersPerWs: 10,
      maxStorageMb: 5000,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      displayName: "",
      stripeProductId: null,
      stripePriceIdMonthly: null,
      stripePriceIdYearly: null,
      maxFileSizeMb: 0,
      maxMeetingsPerMo: 0,
      maxProjects: 0,
      analyticsAccess: false,
      prioritySupport: false,
      apiAccess: false,
      customBranding: false,
      advancedReports: false,
      maxWorkspacesOwned: 0,
      monthlyPriceCents: 0,
      yearlyPriceCents: 0,
      active: false,
      sortOrder: 0
    });
  });

  const mockProvider = {
    name: "stripe",
    verifyAndParseWebhook: vi.fn(),
  };

  it("returns 200 for a valid SUBSCRIPTION_CREATED event", async () => {
    const event: NormalisedSubscriptionEvent = {
      providerEventId: "evt_sub_created",
      type: "SUBSCRIPTION_CREATED",
      providerSubscriptionId: "sub_123",
      providerCustomerId: "cus_123",
      providerPriceId: "price_123",
      planName: "PRO",
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialStart: null,
      trialEnd: null,
      metadata: { workspaceId: "ws_123", ownerId: "user_123" },
      raw: { id: "evt_sub_created" },
    };

    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
    mockProvider.verifyAndParseWebhook.mockResolvedValue(event);

    const response = await request(app)
      .post("/webhooks/billing")
      .send({ dummy: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws_123" },
        create: expect.objectContaining({
          stripeSubscriptionId: "sub_123",
          status: "ACTIVE",
        }),
      }),
    );
    expect(prisma.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws_123" },
        data: expect.objectContaining({
          plan: "PRO",
        }),
      }),
    );
    expect(BILLING_CACHE.invalidateWorkspace).toHaveBeenCalledWith("ws_123", "user_123");
  });

  it("returns 200 for a valid INVOICE_PAID event", async () => {
    const event: NormalisedInvoiceEvent = {
      providerEventId: "evt_inv_paid",
      providerInvoiceId: "in_123",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerPaymentId: "pi_123",
      amountDue: 1000,
      amountPaid: 1000,
      amountRemaining: 0,
      currency: "usd",
      status: "PAID",
      invoiceNumber: "INV-001",
      invoicePdfUrl: "http://pdf.com",
      hostedInvoiceUrl: "http://hosted.com",
      periodStart: new Date(),
      periodEnd: new Date(),
      dueDate: new Date(),
      paidAt: new Date(),
      attemptCount: 1,
      paymentMethodType: "card",
      cardLast4: "4242",
      lineItems: [],
      metadata: { workspaceId: "ws_123", ownerId: "user_123" },
      type: "INVOICE_PAID",
      raw: { id: "evt_inv_paid" },
    };

    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
    mockProvider.verifyAndParseWebhook.mockResolvedValue(event);

    // Mock subscription lookup to link invoice
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: "sub_obj_123",
      workspaceId: "ws_123",
    } as any);

    const response = await request(app)
      .post("/webhooks/billing")
      .send({ dummy: true });

    expect(response.status).toBe(200);
    expect(prisma.invoice.upsert).toHaveBeenCalled();
    expect(prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripePaymentIntentId: "pi_123" },
        create: expect.objectContaining({
          amount: 1000,
          status: "SUCCEEDED",
        }),
      }),
    );
  });

  it("returns 400 when webhook verification fails", async () => {
    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider  as any);
    mockProvider.verifyAndParseWebhook.mockRejectedValue(new Error("Invalid signature"));

    const response = await request(app)
      .post("/webhooks/billing")
      .send({ dummy: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Webhook verification failed" });
  });

  it("returns 200 when no event is returned (ignored event)", async () => {
    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
    mockProvider.verifyAndParseWebhook.mockResolvedValue(null);

    const response = await request(app)
      .post("/webhooks/billing")
      .send({ dummy: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
  });

  it("handles idempotency: does not reprocess processed events", async () => {
    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
    mockProvider.verifyAndParseWebhook.mockResolvedValue({
      providerEventId: "evt_already_done",
      type: "SUBSCRIPTION_CREATED",
      // ... other fields
    } as NormalisedSubscriptionEvent);

    vi.mocked(prisma.billingEvent.findUnique).mockResolvedValue({
      providerEventId: "evt_already_done",
      processed: true,
    } as any);

    const response = await request(app)
      .post("/webhooks/billing")
      .send({ dummy: true });

    expect(response.status).toBe(200);
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });
});
