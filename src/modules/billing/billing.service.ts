import { prisma } from "../../lib/prisma.js";
import { getPaymentProvider } from "../../payment/provider.registry.js";
import { BILLING_CACHE } from "../../redis/redis.client.js";
import { UserCache, WorkspaceCache } from "../../lib/redis/cache.client.js";
import { APP_URL, PLAN_LIMITS, PlanName } from "./plans.config.js";
import { WorkspacePlan } from "@prisma/client";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../../errors/index.js";
// ... (rest of the imports)
import type {
  CreateCheckoutInput,
  CreatePortalInput,
  CancelSubscriptionInput,
  ChangePlanInput,
  WorkspaceSubscriptionResponse,
  InvoiceResponse,
} from "./billing.types.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function ensureProviderCustomer(ownerId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const provider = getPaymentProvider();
  const result = await provider.createCustomer({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: ownerId },
  });

  await prisma.user.update({
    where: { id: ownerId },
    data: { stripeCustomerId: result.providerCustomerId },
  });
  await UserCache.invalidateUser(ownerId);
  return result.providerCustomerId;
}

async function assertOwner(workspaceId: string, userId: string) {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });
  if (ws.ownerId !== userId) {
    throw new ForbiddenError("Only the workspace owner can manage billing");
  }
  return ws;
}

const PLAN_RANK: Record<string, number> = {
  FREE: 0,
  PRO: 1,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

// ─── Public BillingService ────────────────────────────────────────────────────

export const BillingService = {
  async createCheckoutSession(input: CreateCheckoutInput): Promise<string> {
    const { workspaceId, workspaceSlug, ownerId, planName, billingCycle } =
      input;
    
    await assertOwner(workspaceId, ownerId);

    const existing = await BillingService.getWorkspaceSubscription(workspaceId);

    
    if (existing?.planName === planName) {
      throw new ConflictError(
        `This workspace is already on the ${planName} plan`,
      );
    }

    const providerCustomerId = await ensureProviderCustomer(ownerId);

    
    const provider = getPaymentProvider();


    // One 14-day trial per customer — a user who cancels (or lets a trial lapse)
    // and re-upgrades must not receive a fresh trial every time.
    let trialDays: number | undefined = existing ? undefined : 14;
    if (!existing) {
      const trialUser = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { stripeCustomerId: true },
      });
      if (trialUser?.stripeCustomerId) {
        const priorSub = await prisma.subscription.findFirst({
          where: { stripeCustomerId: trialUser.stripeCustomerId },
          select: { id: true },
        });
        if (priorSub) trialDays = undefined;
      }
    }

const checkoutParams = {
      workspaceId,
      ownerId,
      providerCustomerId,
      planName,
      billingCycle,
      trialDays,
      successUrl: `${APP_URL}/dashboard/workspaces/${workspaceSlug}/billing/success?plan=${planName}&cycle=${billingCycle}`,
      cancelUrl: `${APP_URL}/dashboard/workspaces/${workspaceSlug}/billing/upgrade?canceled=true`,
      metadata: { workspaceId, ownerId, planName, billingCycle },
    };
    


    const result = await provider.createCheckoutSession(checkoutParams);
    

    return result.url;
  },

  async createPortalSession(input: CreatePortalInput): Promise<string> {
    const { workspaceId, ownerId, workspaceSlug } = input;
    await assertOwner(workspaceId, ownerId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
    });
    if (!user.stripeCustomerId) throw new NotFoundError("Billing account");

    const provider = getPaymentProvider();
    const result = await provider.createPortalSession({
      providerCustomerId: user.stripeCustomerId,
      returnUrl: `${APP_URL}/dashboard/workspaces/${workspaceSlug}/billing`,
    });
    return result.url;
  },

  async getWorkspaceSubscription(
    workspaceId: string,
  ): Promise<WorkspaceSubscriptionResponse | null> {
    const cached = await BILLING_CACHE.getSubscription(workspaceId);
    if (cached) return cached;

    const sub = await prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    if (!sub || sub.status === "CANCELED") return null;

    const response: WorkspaceSubscriptionResponse = {
      workspaceId: sub.workspaceId,
      planName: sub.plan.name,
      status: sub.status,
      billingCycle: sub.billingCycle,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEnd: sub.trialEnd,
      stripeSubscriptionId: sub.stripeSubscriptionId,
    };
    
    // Only cache if we have valid data
    if (response.planName && response.status) {
      await BILLING_CACHE.setSubscription(workspaceId, response);
    }
    
    return response;
  },

  async changePlan(
    input: ChangePlanInput,
  ): Promise<WorkspaceSubscriptionResponse | null> {
    const { workspaceId, ownerId, newPlanName, billingCycle } = input;
    await assertOwner(workspaceId, ownerId);

    if (newPlanName === "FREE") {
      await BillingService.cancelSubscription({
        workspaceId,
        ownerId,
        immediately: false,
        reason: "downgrade_to_free",
      });
      return null;
    }

    const sub = await prisma.subscription.findUnique({
      where: { workspaceId },
    });
    if (!sub || !["ACTIVE", "TRIALING"].includes(sub.status)) {
      throw new NotFoundError("Active subscription");
    }

    const targetCycle = billingCycle ?? sub.billingCycle;

    const newPlan = await prisma.plan.findUnique({
      where: { name: newPlanName },
    });
    if (!newPlan) throw new BadRequestError(`Plan not found: ${newPlanName}`);

    // Resolve the price ID from the source that matches the ACTIVE provider.
    //   Stripe: the Plan row's stripePriceId* columns first (single source of
    //           truth — webhooks resolve the plan back from these same IDs),
    //           then the STRIPE_PRICE_* env var.
    //   Paddle: the PADDLE_PRICE_* env vars ONLY. The Plan table's
    //           stripePriceId* columns hold Stripe price IDs (seeded from
    //           STRIPE_PRICE_*), so they must never be sent to Paddle — a
    //           Stripe `price_...` ID makes Paddle's subscriptions.update fail.
    //           This mirrors PaddleProvider.createCheckoutSession, which also
    //           resolves prices from PADDLE_PRICE_IDS (env).
    //   Lemon Squeezy: uses variant IDs instead of price IDs. The
    //           LEMONSQUEEZY_VARIANT_* env vars map plan names to variant IDs.
    //           Like Paddle, variant IDs must never be mixed with Stripe price IDs.
    const providerName = (
      process.env.PAYMENT_PROVIDER ?? "lemonsqueezy"
    ).toLowerCase();
    const providerPrefix = providerName === "paddle" ? "PADDLE" : providerName === "lemonsqueezy" ? "LEMONSQUEEZY" : "STRIPE";
    let newPriceId: string | undefined;
    if (providerName === "paddle") {
      newPriceId = process.env[`PADDLE_PRICE_${newPlanName}_${targetCycle}`];
    } else if (providerName === "lemonsqueezy") {
      newPriceId = process.env[`LEMONSQUEEZY_VARIANT_${newPlanName}_${targetCycle}`];
    } else {
      newPriceId = (targetCycle === "YEARLY"
          ? newPlan.stripePriceIdYearly
          : newPlan.stripePriceIdMonthly) ??
        process.env[`STRIPE_PRICE_${newPlanName}_${targetCycle}`];
    }
    if (!newPriceId)
      throw new BadRequestError(
        `No price configured for ${newPlanName} ${targetCycle} (${
          providerName === "paddle"
            ? `set PADDLE_PRICE_${newPlanName}_${targetCycle}`
            : providerName === "lemonsqueezy"
            ? `set LEMONSQUEEZY_VARIANT_${newPlanName}_${targetCycle}`
            : `set the Plan row or STRIPE_PRICE_${newPlanName}_${targetCycle}`
        })`,
      );

    const currentPlan = await prisma.plan.findUnique({
      where: { id: sub.planId },
    });
    const isUpgrade =
      (PLAN_RANK[newPlanName] ?? 0) >
      (PLAN_RANK[currentPlan?.name ?? "FREE"] ?? 0);

    const provider = getPaymentProvider();
    await provider.changePlan({
      providerSubscriptionId: sub.stripeSubscriptionId,
      newProviderPriceId: newPriceId,
      isUpgrade,
      metadata: { workspaceId, planName: newPlanName, ownerId },
    });

    // Persist the change immediately so the app and the provider never diverge,
    // even if the customer.subscription.updated webhook is delayed or lost.
    // (The webhook later confirms/corrects this — same values, idempotent.)
    await prisma.subscription.update({
      where: { workspaceId },
      data: {
        planId: newPlan.id,
        billingCycle: targetCycle,
        stripePriceId: newPriceId,
      },
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        plan: newPlanName as WorkspacePlan,
        maxMembers: newPlan.maxMembersPerWs,
        maxStorage: newPlan.maxStorageMb,
      },
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });
    
    await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace?.slug);
    return null;
  },

  async cancelSubscription(
    input: CancelSubscriptionInput,
  ): Promise<{ cancelAtPeriodEnd: boolean }> {
    const { workspaceId, ownerId, immediately = false, reason } = input;
    await assertOwner(workspaceId, ownerId);

    const sub = await prisma.subscription.findUnique({
      where: { workspaceId },
    });
    if (!sub || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) {
      throw new NotFoundError("Active subscription");
    }

    const provider = getPaymentProvider();
    await provider.cancelSubscription({
      providerSubscriptionId: sub.stripeSubscriptionId,
      immediately,
      reason,
    });

    // Optimistically update the DB immediately so the user sees the correct
    // state without waiting for the webhook. The webhook handler is idempotent
    // and will reconcile if Paddle's status differs.
    if (immediately) {
      const freePlan = await prisma.plan.findUnique({ where: { name: 'FREE' } });
      await prisma.subscription.update({
        where: { workspaceId },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          cancelAtPeriodEnd: false,
          cancelReason: reason ?? 'user_canceled',
        },
      });
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          plan: 'FREE',
          maxMembers: freePlan?.maxMembersPerWs ?? 5,
          maxStorage: freePlan?.maxStorageMb ?? 500,
        },
      });
    } else {
      // End-of-period cancel: mark intent, actual CANCELED status arrives via webhook
      await prisma.subscription.update({
        where: { workspaceId },
        data: { cancelAtPeriodEnd: true, cancelReason: reason ?? 'user_canceled' },
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });
    
    await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace?.slug);
    return { cancelAtPeriodEnd: !immediately };
  },

  async reactivateSubscription(
    workspaceId: string,
    ownerId: string,
  ): Promise<void> {
    await assertOwner(workspaceId, ownerId);

    const sub = await prisma.subscription.findUnique({
      where: { workspaceId },
    });
    if (!sub?.cancelAtPeriodEnd)
      throw new NotFoundError("Subscription pending cancellation");

    const provider = getPaymentProvider();
    await provider.reactivateSubscription({
      providerSubscriptionId: sub.stripeSubscriptionId,
    });

    await prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: false, canceledAt: null, cancelReason: null },
    });
    
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });
    
    await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace?.slug);
  },

  async getInvoices(
    workspaceId: string,
    ownerId: string,
    limit = 20,
  ): Promise<InvoiceResponse[]> {
    await assertOwner(workspaceId, ownerId);

    const redis = await import("../../redis/redis.client.js").then((m) =>
      m.getRedisClient(),
    );
    const cacheKey = BILLING_CACHE.invoiceKey(workspaceId);
    
    try {
      const raw = await redis.get(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        // Validate cached data structure
        if (Array.isArray(cached) && cached.length > 0) {
          const firstInvoice = cached[0];
          if (firstInvoice && firstInvoice.id && typeof firstInvoice.amount === 'number') {
            return cached.slice(0, limit);
          }
        }
      }
    } catch (error) {
      console.error(`[BillingService] Error getting invoice cache for ${workspaceId}:`, error);
      // Continue to fetch from DB
    }

    const invoices = await prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const result: InvoiceResponse[] = invoices.map((inv) => ({
      id: inv.id,
      amount: inv.amountPaid,
      amountRefunded: inv.amountRefunded,
      refundedAt: inv.refundedAt,
      currency: inv.currency,
      status: inv.status,
      pdfUrl: inv.invoicePdf,
      hostedUrl: inv.hostedUrl,
      invoiceNumber: inv.invoiceNumber,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      paidAt: inv.paidAt,
      createdAt: inv.createdAt,
    }));

    try {
      await redis.setex(
        cacheKey,
        BILLING_CACHE.INVOICE_TTL,
        JSON.stringify(result),
      );
    } catch (error) {
      console.error(`[BillingService] Error setting invoice cache for ${workspaceId}:`, error);
    }
    
    return result;
  },

  async getWorkspacePlanLimits(workspaceId: string) {
    if (!workspaceId) throw new BadRequestError("workspaceId is required");

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true },
    });
    const planName = ws.plan as string;
    const cached = await BILLING_CACHE.getPlanLimits(planName);
    if (cached) return cached;

    const plan = await prisma.plan.findUnique({ where: { name: planName } });
    const limits =
      plan ?? PLAN_LIMITS[planName as PlanName] ?? PLAN_LIMITS.FREE;
    await BILLING_CACHE.setPlanLimits(planName, limits);
    return limits;
  },

  async getUserHighestPlan(userId: string): Promise<PlanName> {
    const ownedWorkspaces = await prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { plan: true },
    });

    let highestPlan: PlanName = "FREE";
    for (const ws of ownedWorkspaces) {
      if ((PLAN_RANK[ws.plan] ?? 0) > (PLAN_RANK[highestPlan] ?? 0))
        highestPlan = ws.plan as PlanName;
    }
    return highestPlan;
  },

  async getUserWorkspaceCreationLimit(userId: string): Promise<number> {
    const cached = await BILLING_CACHE.getUserWsLimit(userId);
    if (cached !== null) return cached;

    const MAX_WORKSPACES: Record<string, number> = {
      FREE: PLAN_LIMITS.FREE.maxWorkspacesOwned,
      PRO: PLAN_LIMITS.PRO.maxWorkspacesOwned,
      BUSINESS: PLAN_LIMITS.BUSINESS.maxWorkspacesOwned,
      ENTERPRISE: -1,
    };

    const highestPlan = await BillingService.getUserHighestPlan(userId);

    const limit =
      MAX_WORKSPACES[highestPlan] ?? PLAN_LIMITS.FREE.maxWorkspacesOwned;
    await BILLING_CACHE.setUserWsLimit(userId, limit);
    return limit;
  },
};
