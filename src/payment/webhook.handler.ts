// backend/src/payment/webhook.handler.ts

import { Request, Response } from "express";
import { getPaymentProvider } from "./provider.registry.js";
import type {
  NormalisedSubscriptionEvent,
  NormalisedInvoiceEvent,
  NormalisedRefundEvent,
} from "./IpaymentProvider.js";
import {
  BillingEventType,
  SubStatus,
  WorkspacePlan,
  InvoiceStatus,
  BillingCycle,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { BILLING_CACHE } from "../redis/redis.client.js";
import { WorkspaceCache } from "../lib/redis/cache.client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDate(
  value: Date | null | undefined,
  fallback: Date = new Date(),
): Date {
  if (!value || isNaN(value.getTime())) return fallback;
  return value;
}

// ---------------------------------------------------------------------------
// Workspace resolvers
//
// Both resolvers use the same column names (stripeSubscriptionId /
// stripeCustomerId) because those columns store the provider's ID regardless
// of which provider is active — the column names are legacy labels only.
// If you ever run a migration to rename them to providerSubscriptionId /
// providerCustomerId, update the `where` keys here and in billing.service.ts.
// ---------------------------------------------------------------------------

async function resolveWorkspaceFromSubId(
  providerSubId: string | null,
): Promise<string | undefined> {
  if (!providerSubId) return undefined;

  const sub = await prisma.subscription.findFirst({
    // STRIPE: stripeSubscriptionId holds a Stripe sub ID (sub_xxx)
    // PADDLE: stripeSubscriptionId holds a Paddle sub ID (sub_xxx) — same column, different value
    where: { stripeSubscriptionId: providerSubId },
    select: { workspaceId: true },
  });
  return sub?.workspaceId ?? undefined;
}

async function resolveWorkspaceFromCustomerId(
  customerId: string | null,
): Promise<string | undefined> {
  if (!customerId) return undefined;

  const sub = await prisma.subscription.findFirst({
    // STRIPE: stripeCustomerId holds a Stripe customer ID (cus_xxx)
    // PADDLE: stripeCustomerId holds a Paddle customer ID (ctm_xxx) — same column, different value
    where: { stripeCustomerId: customerId },
    select: { workspaceId: true },
    orderBy: { createdAt: "desc" },
  });
  return sub?.workspaceId ?? undefined;
}

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

export async function webhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const provider = getPaymentProvider();

  let event:
    | NormalisedSubscriptionEvent
    | NormalisedInvoiceEvent
    | NormalisedRefundEvent
    | null;
  try {
    event = await provider.verifyAndParseWebhook(
      req.body as Buffer,
      req.headers as Record<string, string | string[] | undefined>,
    );
  } catch (err) {
    console.error("[Webhook] Verification failed:", err);
    res.status(400).json({ error: "Webhook verification failed" });
    return;
  }

  if (!event) {
    res.json({ received: true });
    return;
  }

  // ── Idempotency check ────────────────────────────────────────────────────
  // stripeEventId column stores the provider event ID regardless of provider.
  // SWITCH TO STRIPE: no change needed — Stripe event IDs (evt_xxx) go here.
  // SWITCH TO PADDLE: no change needed — Paddle event IDs (evt_xxx) go here.
  // TODO (optional): rename column to providerEventId in a future migration.
  const existing = await prisma.billingEvent.findUnique({
where: { providerEventId: event.providerEventId },
  });

  if (existing?.processed) {
    console.log(`[Webhook] Already processed: ${event.providerEventId}`);
    res.json({ received: true });
    return;
  }

  const billingEvent = await prisma.billingEvent.upsert({
where: { providerEventId: event.providerEventId },
    create: {
providerEventId: event.providerEventId,
      type:          mapEventType(event.type),
      payload:       event.raw as any,
      processed:     false,
    },
    update: {},
  });

  try {
    await processEvent(event);
    await prisma.billingEvent.update({
      where: { id: billingEvent.id },
      data:  { processed: true },
    });
    res.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Webhook] Processing failed for ${event.type}:`, message);
    await prisma.billingEvent.update({
      where: { id: billingEvent.id },
      data:  { error: message },
    });
    res.status(500).json({ error: "Processing failed" });
  }
}

// ---------------------------------------------------------------------------
// Event router
// ---------------------------------------------------------------------------

async function processEvent(
  event: NormalisedSubscriptionEvent | NormalisedInvoiceEvent | NormalisedRefundEvent,
): Promise<void> {
  switch (event.type) {
    case "CHECKOUT_COMPLETED":
      return handleCheckoutCompleted(event as NormalisedSubscriptionEvent);
    case "SUBSCRIPTION_CREATED":
    case "SUBSCRIPTION_UPDATED":
    case "SUBSCRIPTION_TRIAL_STARTED":
    case "SUBSCRIPTION_ACTIVATED":
    case "SUBSCRIPTION_PAUSED":
    case "SUBSCRIPTION_RESUMED":
      return handleSubscriptionUpserted(event as NormalisedSubscriptionEvent);
    case "SUBSCRIPTION_CANCELED":
      return handleSubscriptionCanceled(event as NormalisedSubscriptionEvent);
    case "SUBSCRIPTION_TRIAL_ENDING": // Stripe-only: customer.subscription.trial_will_end
      return handleTrialEnding(event as NormalisedSubscriptionEvent);
    case "INVOICE_PAID":
      return handleInvoicePaid(event as NormalisedInvoiceEvent);
    case "INVOICE_PAYMENT_FAILED":
      return handleInvoicePaymentFailed(event as NormalisedInvoiceEvent);
    case "INVOICE_CREATED":
    case "INVOICE_UPDATED":
      return handleInvoiceUpsert(event as NormalisedInvoiceEvent);
    case "REFUND_CREATED":
    case "REFUND_UPDATED":
      return handleRefund(event as NormalisedRefundEvent);
    default:
      // Unreachable for known event types (the switch is exhaustive), but kept
      // for forward-compatibility with provider events we don't handle yet.
      console.log("[Webhook] No handler for event type:", event);
  }
}

// ---------------------------------------------------------------------------
// Subscription handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(event: NormalisedSubscriptionEvent) {
  const workspaceId = event.metadata?.workspaceId;
  const ownerId = event.metadata?.ownerId;
  const planName = event.metadata?.planName;
  const billingCycle = event.metadata?.billingCycle;

  console.log(`[Webhook] Checkout completed for workspace ${workspaceId}, plan: ${planName}`);

  if (!workspaceId || !planName) {
    console.error("[Webhook] Checkout completed event missing workspaceId or planName — cannot provision subscription");
    // Throw so the error is recorded in BillingEvent and Stripe retries
    throw new Error(`Checkout completed event missing workspaceId or planName`);
  }

  // If Stripe hasn't created the subscription yet (rare edge case), defer to customer.subscription.created
  if (!event.providerSubscriptionId) {
    console.log("[Webhook] No subscription ID yet in checkout.session.completed — deferring to customer.subscription.created");
    return;
  }

  try {
    const plan = await prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) {
      console.error("[Webhook] Plan not found in DB:", planName);
      // Throw so the error is recorded in BillingEvent and Stripe retries
      throw new Error(`Plan not found in DB: ${planName}`);
    }

    const existingSub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (existingSub) {
      console.log(`[Webhook] Subscription already exists for workspace ${workspaceId}, skipping creation`);
      return;
    }

    await prisma.subscription.create({
      data: {
        workspaceId,
        stripeSubscriptionId: event.providerSubscriptionId,
        stripeCustomerId: event.providerCustomerId,
        stripePriceId: event.providerPriceId,
        planId: plan.id,
        billingCycle: billingCycle as BillingCycle ?? "MONTHLY",
        status: "INCOMPLETE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        metadata: event.metadata as any,
      },
    });

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        plan: planName as WorkspacePlan,
        maxMembers: plan.maxMembersPerWs,
        maxStorage: plan.maxStorageMb,
      },
    });

    await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
    await WorkspaceCache.invalidateWorkspace(workspaceId, (await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } }))?.slug ?? '');

    console.log(`[Webhook] ✅ Subscription created from checkout.session.completed for workspace ${workspaceId}`);
  } catch (error) {
    console.error(`[Webhook] ❌ Error creating subscription from checkout for workspace ${workspaceId}:`, error);
    throw error;
  }
}

async function handleSubscriptionUpserted(event: NormalisedSubscriptionEvent) {
  const workspaceId = event.metadata?.workspaceId;
  const ownerId = event.metadata?.ownerId;

  console.log(`[Webhook] Processing subscription event: ${event.type} for workspace ${workspaceId ?? "(unknown)"}`);

  if (!workspaceId) {
  console.error("[Webhook] ❌ CRITICAL: Subscription event missing workspaceId metadata");
  console.error("[Webhook] Available metadata keys:", Object.keys(event.metadata || {}));
  // 🔧 throw so the outer handler marks processed=false + records the error,
  // and Stripe retries the delivery instead of us silently swallowing it
  throw new Error(
    `Subscription event ${event.providerEventId} missing workspaceId metadata`,
  );
}

  // providerSubscriptionId is always present for subscription.* events; null only on checkout.session.completed
  if (!event.providerSubscriptionId) {
    throw new Error(
      `Subscription event ${event.providerEventId} missing providerSubscriptionId`,
    );
  }
  try {
    console.log("[Webhook] Looking up plan:", event.planName);
    const plan = await prisma.plan.findUnique({ where: { name: event.planName } });
    if (!plan) {
      console.error("[Webhook] ❌ Plan not found in DB:", event.planName);
      throw new Error(`Plan not found in DB: ${event.planName}`);
    }
    console.log("[Webhook] Plan found:", plan.name, "ID:", plan.id);

    console.log("[Webhook] Attempting subscription upsert for workspace:", workspaceId);
    const subscription = await prisma.subscription.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        // STRIPE: providerSubscriptionId = sub_xxx
        // PADDLE: providerSubscriptionId = sub_xxx
        // Column is named stripeSubscriptionId — legacy label, stores any provider's sub ID.
        // TO SWITCH BACK TO STRIPE: no change needed here.
        stripeSubscriptionId: event.providerSubscriptionId,
        // STRIPE: providerCustomerId = cus_xxx
        // PADDLE: providerCustomerId = ctm_xxx
        // Same pattern — legacy column name, provider-agnostic value stored.
        stripeCustomerId:     event.providerCustomerId,
        stripePriceId:        event.providerPriceId,
        planId:               plan.id,
        billingCycle:         event.billingCycle,
        status:               event.status as SubStatus,
        currentPeriodStart:   safeDate(event.currentPeriodStart),
        currentPeriodEnd:     safeDate(
          event.currentPeriodEnd,
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ),
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        canceledAt:        event.canceledAt,
        trialStart:        event.trialStart,
        trialEnd:          event.trialEnd,
        metadata:          event.metadata as any,
      },
      update: {
        stripeSubscriptionId: event.providerSubscriptionId,
        stripePriceId:        event.providerPriceId,
        planId:               plan.id,
        billingCycle:         event.billingCycle,
        status:               event.status as SubStatus,
        currentPeriodStart:   safeDate(event.currentPeriodStart),
        currentPeriodEnd:     safeDate(
          event.currentPeriodEnd,
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ),
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        canceledAt:        event.canceledAt,
        trialEnd:          event.trialEnd,
        metadata:          event.metadata as any,
      },
    });

    console.log(`[Webhook] ✅ Subscription upsert successful: id=${subscription.id} workspace=${workspaceId}`);

    console.log("[Webhook] Updating workspace plan for workspace:", workspaceId);
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        plan:       event.planName as WorkspacePlan,
        maxMembers: plan.maxMembersPerWs,
        maxStorage: plan.maxStorageMb,
      },
    });
    console.log("[Webhook] ✅ Workspace updated:", workspace.id, "plan:", workspace.plan);

    await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace.slug);
    console.log(
      `[Webhook] ✅ Cache invalidated for workspace=${workspaceId} plan=${event.planName} status=${event.status}`,
    );

    // Backfill any invoices that arrived before the subscription row was created
    const savedSub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (savedSub) {
      const backfilled = await prisma.invoice.updateMany({
        where: { workspaceId, subscriptionId: null },
        data:  { subscriptionId: savedSub.id, payerId: ownerId ?? undefined },
      });
      if (backfilled.count > 0) {
        console.log(`[Webhook] ✅ Backfilled ${backfilled.count} invoices for workspace ${workspaceId}`);
        await BILLING_CACHE.invalidateWorkspace(workspaceId, ownerId);
      }
    }


  } catch (error) {
    console.error(`[Webhook] ❌ Error during subscription upsert for workspace ${workspaceId}:`, error);
    console.error("[Webhook] Error details:", error instanceof Error ? error.message : String(error));
    console.error("[Webhook] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    console.log("[Webhook] ===== SUBSCRIPTION UPSERT FAILED (ERROR) =====");
    throw error;
  }
}

async function handleSubscriptionCanceled(event: NormalisedSubscriptionEvent) {
  const { workspaceId } = event.metadata;
  if (!workspaceId) {
  console.error("[Webhook] ❌ CRITICAL: Subscription event missing workspaceId metadata");
  console.error("[Webhook] Available metadata keys:", Object.keys(event.metadata || {}));
  // 🔧 throw so the outer handler marks processed=false + records the error,
  // and Stripe retries the delivery instead of us silently swallowing it
  throw new Error(
    `Subscription event ${event.providerEventId} missing workspaceId metadata`,
  );
}

  await prisma.subscription.update({
    where: { workspaceId },
    data:  { status: "CANCELED", canceledAt: new Date() },
  });

  const freePlan = await prisma.plan.findUnique({ where: { name: "FREE" } });
  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      plan:       "FREE",
      maxMembers: freePlan?.maxMembersPerWs ?? 5,
      maxStorage: freePlan?.maxStorageMb ?? 500,
    },
  });

  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { ownerId: true },
  });
  await BILLING_CACHE.invalidateWorkspace(workspaceId, ws?.ownerId);
  await WorkspaceCache.invalidateWorkspace(workspaceId, workspace.slug);
  console.log(`[Webhook] Workspace ${workspaceId} downgraded to FREE`);
}

async function handleTrialEnding(event: NormalisedSubscriptionEvent) {
  const { workspaceId } = event.metadata;
  if (!workspaceId) {
    throw new Error(
      `Trial ending event ${event.providerEventId} missing workspaceId metadata`,
    );
  }
  // TODO: send "trial ending soon" email
  console.log(`[Webhook] Trial ending soon for workspace ${workspaceId}`);
}

// ---------------------------------------------------------------------------
// Invoice handlers
// ---------------------------------------------------------------------------

async function handleInvoicePaid(event: NormalisedInvoiceEvent) {
  const invoice = await upsertInvoice(event);

  if (event.providerPaymentId) {
    const workspaceId = await resolveWorkspaceFromSubId(event.providerSubscriptionId);

    await prisma.payment.upsert({
      // STRIPE: stripePaymentIntentId = pi_xxx
      // PADDLE: stripePaymentIntentId = Paddle paymentAttemptId (paymtatt_xxx)
      // Column is named stripePaymentIntentId — legacy label, stores any provider's payment ID.
      // TO SWITCH BACK TO STRIPE: no change needed here.
      where:  { stripePaymentIntentId: event.providerPaymentId },
      create: {
        stripePaymentIntentId: event.providerPaymentId,
        workspaceId:           workspaceId ?? undefined,
        payerId:               event.metadata?.ownerId ?? undefined,
        invoiceId:             invoice?.id,
        amount:                event.amountPaid,
        currency:              event.currency,
        status:                "SUCCEEDED",
        paymentMethod:         event.paymentMethodType ?? undefined,
        last4:                 event.cardLast4 ?? undefined,
      },
      update: {
        status: "SUCCEEDED",
        ...(invoice?.id && { invoiceId: invoice.id }),
      },
    });
  }

  console.log(`[Webhook] Invoice paid: ${event.providerInvoiceId}`);
}

async function handleInvoicePaymentFailed(event: NormalisedInvoiceEvent) {
  await upsertInvoice(event);

  if (event.providerSubscriptionId) {
    const sub = await prisma.subscription.findFirst({
      // STRIPE: stripeSubscriptionId = sub_xxx
      // PADDLE: stripeSubscriptionId = Paddle sub ID (sub_xxx) — same column
      where: { stripeSubscriptionId: event.providerSubscriptionId },
    });
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data:  { status: "PAST_DUE" },
      });
      await BILLING_CACHE.invalidateWorkspace(sub.workspaceId);
    }
  }

  console.warn(`[Webhook] Invoice payment FAILED: ${event.providerInvoiceId}`);
}

async function handleInvoiceUpsert(event: NormalisedInvoiceEvent) {
  await upsertInvoice(event);
}

// ---------------------------------------------------------------------------
// Invoice upsert — shared by paid, failed, created, updated handlers
// ---------------------------------------------------------------------------

async function upsertInvoice(
  event: NormalisedInvoiceEvent,
): Promise<{ id: string } | null> {
  console.log(`[Webhook] Invoice event: ${event.status} ${event.providerInvoiceId}`);

  // 1. Try metadata first (fastest — always set by Paddle via customData)
  let workspaceId: string | undefined = event.metadata?.workspaceId || undefined;

  // 2. Fall back to subscription lookup
  if (!workspaceId && event.providerSubscriptionId) {
    workspaceId = await resolveWorkspaceFromSubId(event.providerSubscriptionId);
  }

  // 3. Fall back to customer lookup
  if (!workspaceId && event.providerCustomerId) {
    workspaceId = await resolveWorkspaceFromCustomerId(event.providerCustomerId);
  }

  if (!workspaceId) {
    console.error("[Webhook] Invoice event missing workspaceId — skipping invoice creation");
    // Throw so the error is recorded in BillingEvent and Stripe retries.
    // On retry the subscription DB row may already exist and fallback steps 2-3 succeed.
    throw new Error(
      `Invoice event ${event.providerInvoiceId} missing workspaceId — no subscription row yet`,
    );
  }

  // Resolve the subscription row to link the invoice
  const sub = event.providerSubscriptionId
    ? await prisma.subscription.findFirst({
        // STRIPE: stripeSubscriptionId = sub_xxx
        // PADDLE: stripeSubscriptionId = Paddle sub ID — same column
        where: { stripeSubscriptionId: event.providerSubscriptionId },
      })
    : null;

  // Resolve payer — metadata ownerId is most reliable, then workspace owner
  const payerId: string | undefined =
    event.metadata?.ownerId ||
    (workspaceId
      ? (await prisma.workspace.findUnique({
          where:  { id: workspaceId },
          select: { ownerId: true },
        }))?.ownerId
      : undefined) ||
    undefined;

  const savedInvoice = await prisma.invoice.upsert({
    // STRIPE: stripeInvoiceId = in_xxx
    // PADDLE: stripeInvoiceId = Paddle transaction ID (txn_xxx) — same column, legacy label
    // TO SWITCH BACK TO STRIPE: no change needed here.
    where:  { stripeInvoiceId: event.providerInvoiceId },
    create: {
      stripeInvoiceId: event.providerInvoiceId,
      subscriptionId:  sub?.id,
      workspaceId,
      payerId,
      amountDue:       event.amountDue,
      amountPaid:      event.amountPaid,
      amountRemaining: event.amountRemaining,
      currency:        event.currency,
      status:          event.status as InvoiceStatus,
      invoiceNumber:   event.invoiceNumber,
      invoicePdf:      event.invoicePdfUrl,
      hostedUrl:       event.hostedInvoiceUrl,
      periodStart:     event.periodStart,
      periodEnd:       event.periodEnd,
      dueDate:         event.dueDate,
      paidAt:          event.paidAt,
      lineItems:       event.lineItems as any,
      attemptCount:    event.attemptCount,
    },
    update: {
      ...(sub?.id     && { subscriptionId: sub.id }),
      ...(workspaceId && { workspaceId }),
      ...(payerId     && { payerId }),
      status:          event.status as InvoiceStatus,
      amountDue:       event.amountDue,
      amountPaid:      event.amountPaid,
      amountRemaining: event.amountRemaining,
      invoicePdf:      event.invoicePdfUrl  ?? undefined,
      hostedUrl:       event.hostedInvoiceUrl ?? undefined,
      // A later failure (e.g. a dunning retry) must clear a previously recorded
      // payment so the invoice is never shown as paid when it isn't.
      paidAt:          event.status === "PAID" ? (event.paidAt ?? undefined) : null,
      attemptCount:    event.attemptCount,
    },
  });

  // Invalidate invoice cache when invoice is created/updated
  if (workspaceId) {
    await BILLING_CACHE.invalidateWorkspace(workspaceId, payerId);
  }

  return savedInvoice;
}

// ---------------------------------------------------------------------------
// Refund handler (Paddle adjustments: credit / refund / chargeback)
// ---------------------------------------------------------------------------

const REFUND_ACTIONS = new Set([
  "credit",
  "refund",
  "chargeback",
  "chargeback_warning",
]);

const REFUND_REVERSAL_ACTIONS = new Set([
  "credit_reverse",
  "chargeback_reverse",
  "chargeback_warning_reverse",
]);

async function handleRefund(event: NormalisedRefundEvent) {
  const isReversal = REFUND_REVERSAL_ACTIONS.has(event.action);

  // Only approved adjustments move money. Record everything in BillingEvent
  // (the outer handler does that) but only apply approved adjustments here.
  if (event.status !== "approved") {
    console.log(
      `[Webhook] Refund ${event.providerRefundId} (${event.action}) not applied — status=${event.status}`,
    );
    return;
  }

  // Resolve the workspace: subscription → invoice → customer.
  let workspaceId: string | undefined = event.providerSubscriptionId
    ? await resolveWorkspaceFromSubId(event.providerSubscriptionId)
    : undefined;

  const invoice = event.providerTransactionId
    ? await prisma.invoice.findUnique({
        where: { stripeInvoiceId: event.providerTransactionId },
      })
    : null;

  if (!workspaceId) workspaceId = invoice?.workspaceId ?? undefined;
  if (!workspaceId && event.providerCustomerId) {
    workspaceId = await resolveWorkspaceFromCustomerId(event.providerCustomerId);
  }
  if (!workspaceId) {
    throw new Error(
      `Refund event ${event.providerEventId} missing workspaceId — no invoice or subscription row yet`,
    );
  }

  const payment = invoice?.id
    ? await prisma.payment.findFirst({ where: { invoiceId: invoice.id } })
    : null;

  if (isReversal) {
    // A refund/chargeback was reversed (money returned to the merchant) — undo
    // the refund marks so the invoice/payment reflect the true state.
    if (invoice) {
      const remainingRefunded = Math.max(0, (invoice.amountRefunded ?? 0) - event.amount);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          amountRefunded: { decrement: event.amount },
          ...(remainingRefunded > 0
            ? { status: "REFUNDED" }
            : { status: "PAID", refundedAt: null }),
        },
      });
    }
    if (payment) {
      const remainingRefunded = Math.max(0, (payment.refundedAmount ?? 0) - event.amount);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmount: { decrement: event.amount },
          status: remainingRefunded > 0 ? "PARTIALLY_REFUNDED" : "SUCCEEDED",
          refundedAt: remainingRefunded > 0 ? payment.refundedAt ?? undefined : null,
        },
      });
    }
    await BILLING_CACHE.invalidateWorkspace(workspaceId);
    console.log(`[Webhook] Refund reversed: ${event.providerRefundId} for workspace ${workspaceId}`);
    return;
  }

  if (!REFUND_ACTIONS.has(event.action)) {
    console.log(`[Webhook] Ignoring adjustment action: ${event.action}`);
    return;
  }

  // Apply the refund.
  const fullyRefunded =
    !!invoice && (invoice.amountRefunded ?? 0) + event.amount >= invoice.amountPaid;

  if (invoice) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amountRefunded: { increment: event.amount },
        ...(fullyRefunded
          ? { status: "REFUNDED", refundedAt: new Date() }
          : {}),
      },
    });
  }

  if (payment) {
    const payFullyRefunded =
      (payment.refundedAmount ?? 0) + event.amount >= payment.amount;
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: { increment: event.amount },
        refundedAt:     new Date(),
        status:         payFullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });
  }

  // Full refund → revoke access, matching the refund policy ("once the refund
  // is approved, access may be revoked before the period ends"). DB-side only:
  // the Paddle subscription is expected to have been cancelled as part of the
  // refund process.
  if (invoice && fullyRefunded) {
    const sub = await prisma.subscription.findFirst({
      where: { workspaceId },
    });
    if (sub && sub.status !== "CANCELED") {
      const freePlan = await prisma.plan.findUnique({ where: { name: "FREE" } });
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status:       "CANCELED",
          canceledAt:   new Date(),
          cancelReason: "refunded",
        },
      });
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          plan:       "FREE",
          maxMembers: freePlan?.maxMembersPerWs ?? 5,
          maxStorage: freePlan?.maxStorageMb ?? 500,
        },
      });
    }
  }

  await BILLING_CACHE.invalidateWorkspace(workspaceId);
  console.log(
    `[Webhook] Refund ${event.providerRefundId} (${event.action}) of ${event.amount} ${event.currency} applied for workspace ${workspaceId}`,
  );
}

// ---------------------------------------------------------------------------
// BillingEventType mapper
// ---------------------------------------------------------------------------

function mapEventType(type: string): BillingEventType {
  const map: Record<string, BillingEventType> = {
    CHECKOUT_COMPLETED:        "CHECKOUT_COMPLETED",
    SUBSCRIPTION_CREATED:      "SUBSCRIPTION_CREATED",
    SUBSCRIPTION_UPDATED:      "SUBSCRIPTION_UPDATED",
    SUBSCRIPTION_CANCELED:     "SUBSCRIPTION_CANCELED",
    SUBSCRIPTION_TRIAL_ENDING: "SUBSCRIPTION_TRIAL_ENDED", // Stripe trial_will_end
    // Paddle reports subscription lifecycle as distinct events; the closest
    // BillingEventType (enum has no TRIAL_STARTED/ACTIVATED/PAUSED/RESUMED
    // values) is SUBSCRIPTION_UPDATED — each of these events updates the row.
    SUBSCRIPTION_TRIAL_STARTED: "SUBSCRIPTION_UPDATED",
    SUBSCRIPTION_ACTIVATED:     "SUBSCRIPTION_UPDATED",
    SUBSCRIPTION_PAUSED:        "SUBSCRIPTION_UPDATED",
    SUBSCRIPTION_RESUMED:       "SUBSCRIPTION_UPDATED",
    INVOICE_PAID:              "INVOICE_PAID",
    INVOICE_PAYMENT_FAILED:    "INVOICE_PAYMENT_FAILED",
    INVOICE_CREATED:           "INVOICE_CREATED",
    INVOICE_UPDATED:           "INVOICE_CREATED", // no INVOICE_UPDATED in BillingEventType enum yet
    REFUND_CREATED:            "PAYMENT_REFUNDED",
    REFUND_UPDATED:            "PAYMENT_REFUNDED",
  };
  return map[type] ?? "SUBSCRIPTION_UPDATED";
}