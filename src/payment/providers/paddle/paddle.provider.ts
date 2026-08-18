// backend/src/payment/providers/paddle/paddle.provider.ts

import {
  EventName,
  type AdjustmentCreatedEvent,
  type AdjustmentUpdatedEvent,
  type SubscriptionActivatedEvent,
  type SubscriptionCanceledEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionPastDueEvent,
  type SubscriptionPausedEvent,
  type SubscriptionResumedEvent,
  type SubscriptionTrialingEvent,
  type SubscriptionUpdatedEvent,
  type TransactionBilledEvent,
  type TransactionCompletedEvent,
  type TransactionCreatedEvent,
  type TransactionPaymentFailedEvent,
  type TransactionUpdatedEvent,
} from '@paddle/paddle-node-sdk';

import { BillingCycle } from '@prisma/client';

import type {
  IPaymentProvider,
  CreateCustomerParams,
  CreateCheckoutParams,
  CreatePortalParams,
  ChangePlanParams,
  CancelSubscriptionParams,
  ReactivateSubscriptionParams,
  CustomerResult,
  CheckoutResult,
  PortalResult,
  NormalisedSubscriptionEvent,
  NormalisedInvoiceEvent,
  NormalisedRefundEvent,
  NormalisedSubStatus,
  NormalisedInvoiceStatus,
} from '../../IpaymentProvider.js';

import {
  getPaddle,
  PADDLE_PRICE_IDS,
  PADDLE_PRICE_TO_PLAN,
  getPaddleWebhookSecret,
} from '../../../modules/billing/config/paddle.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL, ExternalApiCache } from '../../../lib/redis/cache.client.js';

// ✅ LAZY CLIENT (critical fix)
function getClient() {
  return getPaddle();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnySubEventData =
  | SubscriptionCreatedEvent['data']
  | SubscriptionUpdatedEvent['data']
  | SubscriptionCanceledEvent['data']
  | SubscriptionTrialingEvent['data'];

type AnyTxnEventData =
  | TransactionCompletedEvent['data']
  | TransactionPaymentFailedEvent['data']
  | TransactionCreatedEvent['data']
  | TransactionUpdatedEvent['data']
  | TransactionBilledEvent['data'];

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

function mapSubStatus(status: string): NormalisedSubStatus {
  const map: Record<string, NormalisedSubStatus> = {
    active: 'ACTIVE',
    canceled: 'CANCELED',
    past_due: 'PAST_DUE',
    paused: 'PAUSED',
    trialing: 'TRIALING',
  };
  return map[status] ?? 'INCOMPLETE';
}

function mapInvoiceStatus(status: string): NormalisedInvoiceStatus {
  const map: Record<string, NormalisedInvoiceStatus> = {
    draft: 'DRAFT',
    ready: 'OPEN',
    billed: 'OPEN',
    paid: 'PAID',
    completed: 'PAID',
    canceled: 'VOID',
    past_due: 'UNCOLLECTIBLE',
  };
  return map[status] ?? 'DRAFT';
}

function mapBillingCycle(interval?: string): BillingCycle {
  return interval === 'year' ? 'YEARLY' : 'MONTHLY';
}

// ---------------------------------------------------------------------------
// Price resolver
// ---------------------------------------------------------------------------

function resolvePriceId(planName: string, billingCycle: BillingCycle): string {
  const prices = PADDLE_PRICE_IDS[planName];

  if (!prices) {
    throw new Error(`[PaddleProvider] No price config for plan: ${planName}`);
  }

  const priceId =
    billingCycle === 'YEARLY' ? prices.yearly : prices.monthly;

  if (!priceId) {
    throw new Error(
      `[PaddleProvider] Missing price for ${planName}_${billingCycle}`
    );
  }

  return priceId;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function toDate(value?: string | null, fallback = new Date()): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

// ---------------------------------------------------------------------------
// Subscription mapper
// ---------------------------------------------------------------------------

function buildSubFields(
  sub: AnySubEventData,
  eventId: string,
  raw: unknown,
): Omit<NormalisedSubscriptionEvent, 'type'> {
  const firstItem = sub.items?.[0];
  const priceId = firstItem?.price?.id ?? '';
  const planMeta = PADDLE_PRICE_TO_PLAN.get(priceId);
  const interval = firstItem?.price?.billingCycle?.interval;

  const customData = (sub.customData ?? {}) as Record<string, string>;

  // Log if workspaceId is missing from customData
  if (!customData.workspaceId) {
    console.error('[PaddleProvider] Subscription event missing workspaceId in customData:', {
      subscriptionId: sub.id,
      customDataKeys: Object.keys(customData),
      customData,
    });
  }

  const trialEnd =
    sub.status === 'trialing' && sub.nextBilledAt
      ? toDate(sub.nextBilledAt)
      : null;

  return {
    providerEventId: eventId,
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customerId,
    providerPriceId: priceId,
    planName: planMeta?.planName ?? customData.planName ?? 'PRO',
    status: mapSubStatus(sub.status),
    billingCycle: mapBillingCycle(interval),
    currentPeriodStart: toDate(sub.currentBillingPeriod?.startsAt),
    currentPeriodEnd: toDate(sub.currentBillingPeriod?.endsAt),
    cancelAtPeriodEnd: sub.scheduledChange?.action === 'cancel',
    canceledAt: sub.canceledAt ? toDate(sub.canceledAt) : null,
    trialStart: sub.status === 'trialing' ? toDate(sub.startedAt) : null,
    trialEnd,
    metadata: customData,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PaddleProvider implements IPaymentProvider {
  readonly name = 'paddle';

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    const cacheKey = CACHE_KEYS.paddleCustomer(`${params.email}`);
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const customer = await getClient().customers.create({
          email: params.email,
          name: params.name,
          customData: params.metadata,
        });
        return { providerCustomerId: customer.id };
      },
      CACHE_TTL.EXTERNAL_API_PADDLE_CUSTOMER,
    );
  }

  async createCheckoutSession(
    params: CreateCheckoutParams,
  ): Promise<CheckoutResult> {
    const priceId = resolvePriceId(params.planName, params.billingCycle);

    const txn = await getClient().transactions.create({
      customerId: params.providerCustomerId,
      items: [{ priceId, quantity: 1 }],
      checkout: { url: params.successUrl },
      customData: {
        workspaceId: params.workspaceId,
        ownerId: params.ownerId,
        planName: params.planName,
        billingCycle: params.billingCycle,
      },
    });

    const url = txn.checkout?.url;
    if (!url) throw new Error('[PaddleProvider] No checkout URL');

    return { url };
  }

  async createPortalSession(
    params: CreatePortalParams,
  ): Promise<PortalResult> {
    const cacheKey = `api:paddle:portal:${params.providerCustomerId}`;
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const session = await getClient().customerPortalSessions.create(
          params.providerCustomerId,
          [],
        );
        return { url: session.urls?.general?.overview ?? '' };
      },
      60, // 1 minute TTL for portal sessions
    );
  }

  async changePlan(params: ChangePlanParams): Promise<void> {
    const cacheKey = CACHE_KEYS.paddleSubscription(params.providerSubscriptionId);
    const sub = await CacheClient.getOrSet(
      cacheKey,
      () => getClient().subscriptions.get(params.providerSubscriptionId),
      CACHE_TTL.EXTERNAL_API_PADDLE_SUBSCRIPTION,
    );

    const updatedItems = (sub.items ?? []).map((item) => ({
      priceId: params.newProviderPriceId,
      quantity: item.quantity ?? 1,
    })) as { priceId: string; quantity: number }[];

    await getClient().subscriptions.update(params.providerSubscriptionId, {
      items: updatedItems,
      prorationBillingMode: params.isUpgrade
        ? 'prorated_immediately'
        : 'prorated_next_billing_period',
      customData: params.metadata,
    });
    await ExternalApiCache.invalidatePaddleSubscription(params.providerSubscriptionId);
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    await getClient().subscriptions.cancel(params.providerSubscriptionId, {
      effectiveFrom: params.immediately
        ? 'immediately'
        : 'next_billing_period',
    });
    await ExternalApiCache.invalidatePaddleSubscription(params.providerSubscriptionId);
  }

  async reactivateSubscription(
    params: ReactivateSubscriptionParams,
  ): Promise<void> {
    await getClient().subscriptions.update(params.providerSubscriptionId, {
      scheduledChange: null,
    });
    await ExternalApiCache.invalidatePaddleSubscription(params.providerSubscriptionId);
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<
    | NormalisedSubscriptionEvent
    | NormalisedInvoiceEvent
    | NormalisedRefundEvent
    | null
  > {
    const sig = headers['paddle-signature'];
    const sigStr = Array.isArray(sig) ? sig[0] : sig;

    if (!sigStr) {
      throw new Error('[PaddleProvider] Missing signature');
    }

    const secret = getPaddleWebhookSecret();

    const event = await getClient().webhooks.unmarshal(
      rawBody.toString('utf-8'),
      secret,
      sigStr,
    );

    if (!event) throw new Error('[PaddleProvider] Invalid webhook');

    const eventId = event.eventId;

    switch (event.eventType) {
      case EventName.SubscriptionCreated:
        return {
          type: 'SUBSCRIPTION_CREATED',
          ...buildSubFields(
            (event as SubscriptionCreatedEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.SubscriptionUpdated:
        return {
          type: 'SUBSCRIPTION_UPDATED',
          ...buildSubFields(
            (event as SubscriptionUpdatedEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.SubscriptionCanceled:
        return {
          type: 'SUBSCRIPTION_CANCELED',
          ...buildSubFields(
            (event as SubscriptionCanceledEvent).data,
            eventId,
            event,
          ),
        };

      // Paddle fires subscription.trialing when a subscription ENTERS trial
      // (trial starts) — NOT when it's about to end. There is no "trial ending
      // soon" event in Paddle, so this is mapped to SUBSCRIPTION_TRIAL_STARTED.
      case EventName.SubscriptionTrialing:
        return {
          type: 'SUBSCRIPTION_TRIAL_STARTED',
          ...buildSubFields(
            (event as SubscriptionTrialingEvent).data,
            eventId,
            event,
          ),
        };

      // subscription.activated: trial ended and the first payment succeeded, or
      // the subscription was (re)activated after being paused.
      case EventName.SubscriptionActivated:
        return {
          type: 'SUBSCRIPTION_ACTIVATED',
          ...buildSubFields(
            (event as SubscriptionActivatedEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.SubscriptionPastDue:
        return {
          type: 'SUBSCRIPTION_UPDATED',
          ...buildSubFields(
            (event as SubscriptionPastDueEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.SubscriptionPaused:
        return {
          type: 'SUBSCRIPTION_PAUSED',
          ...buildSubFields(
            (event as SubscriptionPausedEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.SubscriptionResumed:
        return {
          type: 'SUBSCRIPTION_RESUMED',
          ...buildSubFields(
            (event as SubscriptionResumedEvent).data,
            eventId,
            event,
          ),
        };

      case EventName.TransactionCompleted:
        return this.normaliseTxnAsInvoice(
          'INVOICE_PAID',
          (event as TransactionCompletedEvent).data,
          eventId,
          event,
        );

      case EventName.TransactionPaymentFailed:
        return this.normaliseTxnAsInvoice(
          'INVOICE_PAYMENT_FAILED',
          (event as TransactionPaymentFailedEvent).data,
          eventId,
          event,
        );

      case EventName.TransactionBilled:
        return this.normaliseTxnAsInvoice(
          'INVOICE_CREATED',
          (event as TransactionBilledEvent).data,
          eventId,
          event,
        );

      case EventName.TransactionUpdated:
        return this.normaliseTxnAsInvoice(
          'INVOICE_UPDATED',
          (event as TransactionUpdatedEvent).data,
          eventId,
          event,
        );

      // Paddle reports refunds, credits, and chargebacks as adjustments against
      // a transaction (adjustment.created / adjustment.updated).
      case EventName.AdjustmentCreated:
        return this.normaliseAdjustmentAsRefund(
          'REFUND_CREATED',
          (event as AdjustmentCreatedEvent).data,
          eventId,
          event,
        );

      case EventName.AdjustmentUpdated:
        return this.normaliseAdjustmentAsRefund(
          'REFUND_UPDATED',
          (event as AdjustmentUpdatedEvent).data,
          eventId,
          event,
        );

      default:
        return null;
    }
  }

  private normaliseAdjustmentAsRefund(
    type: 'REFUND_CREATED' | 'REFUND_UPDATED',
    adj: AdjustmentCreatedEvent['data'],
    eventId: string,
    raw: unknown,
  ): NormalisedRefundEvent {
    return {
      type,
      providerEventId: eventId,
      providerRefundId: adj.id,
      providerTransactionId: adj.transactionId ?? null,
      providerSubscriptionId: adj.subscriptionId ?? null,
      providerCustomerId: adj.customerId ?? null,
      action: adj.action,
      status: adj.status,
      // Adjustment totals are negative (money returned to the customer), so the
      // handler stores the magnitude in minor units — consistent with every
      // other amount in the billing tables.
      amount: Math.abs(Number(adj.totals?.total ?? 0)),
      currency: (adj.currencyCode ?? 'USD').toLowerCase(),
      metadata: {},
      raw,
    };
  }

  private normaliseTxnAsInvoice(
    type: NormalisedInvoiceEvent['type'],
    txn: AnyTxnEventData,
    eventId: string,
    raw: unknown,
  ): NormalisedInvoiceEvent {
    const customData = (txn.customData ?? {}) as Record<string, string>;
    const totals = txn.details?.totals;

    const amountDue = Number(totals?.grandTotal ?? totals?.total ?? 0);

    const lastPayment =
      txn.payments?.[txn.payments.length - 1];

    const amountPaid = lastPayment?.amount
      ? Number(lastPayment.amount)
      : 0;

    const amountRemaining = Math.max(0, amountDue - amountPaid);

    let paymentMethodType: string | null = null;
    let cardLast4: string | null = null;

    if (lastPayment?.methodDetails) {
      paymentMethodType = lastPayment.methodDetails.type ?? null;
      cardLast4 = lastPayment.methodDetails.card?.last4 ?? null;
    }

    const lineItems = (txn.details?.lineItems ?? []).map((item) => ({
      priceId: item.priceId ?? null,
      quantity: item.quantity ?? 1,
      name: item.product?.name ?? null,
      amount: Number(item.unitTotals?.total ?? item.totals?.total ?? 0),
    }));

    const paidAt = lastPayment?.capturedAt
      ? toDate(lastPayment.capturedAt)
      : lastPayment?.status === 'captured'
        ? toDate(lastPayment.createdAt)
        : null;

    return {
      type,
      providerEventId: eventId,
      providerInvoiceId: txn.id,
      providerCustomerId: txn.customerId ?? null,
      providerSubscriptionId: txn.subscriptionId ?? null,
      providerPaymentId: lastPayment?.paymentAttemptId ?? null,
      amountDue,
      amountPaid,
      amountRemaining,
      currency: (txn.currencyCode ?? 'USD').toLowerCase(),
      status: mapInvoiceStatus(txn.status),
      invoiceNumber: txn.invoiceNumber ?? txn.invoiceId ?? null,
      invoicePdfUrl: null,
      hostedInvoiceUrl: null,
      periodStart: txn.billingPeriod?.startsAt
        ? toDate(txn.billingPeriod.startsAt)
        : null,
      periodEnd: txn.billingPeriod?.endsAt
        ? toDate(txn.billingPeriod.endsAt)
        : null,
      dueDate: null,
      paidAt,
      attemptCount: txn.payments?.length ?? 0,
      paymentMethodType,
      cardLast4,
      lineItems: lineItems.length > 0 ? lineItems : [],
      metadata: customData,
      raw,
    };
  }
}