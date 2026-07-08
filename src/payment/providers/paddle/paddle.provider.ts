// backend/src/payment/providers/paddle/paddle.provider.ts

import {
  EventName,
  type SubscriptionCreatedEvent,
  type SubscriptionUpdatedEvent,
  type SubscriptionCanceledEvent,
  type SubscriptionTrialingEvent,
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
    trialStart: null,
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
    NormalisedSubscriptionEvent | NormalisedInvoiceEvent | null
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

      case EventName.SubscriptionTrialing:
        return {
          type: 'SUBSCRIPTION_TRIAL_ENDING',
          ...buildSubFields(
            (event as SubscriptionTrialingEvent).data,
            eventId,
            event,
          ),
        };

      default:
        return null;
    }
  }

  private normaliseTxnAsInvoice(
    type: NormalisedInvoiceEvent['type'],
    txn: AnyTxnEventData,
    eventId: string,
    raw: unknown,
  ): NormalisedInvoiceEvent {
    const customData = (txn.customData ?? {}) as Record<string, string>;
    const totals = txn.details?.totals;

    const amountDue = Number(totals?.total ?? 0);

    const lastPayment =
      txn.payments?.[txn.payments.length - 1];

    const amountPaid = lastPayment?.amount
      ? Number(lastPayment.amount)
      : 0;

    const amountRemaining = Math.max(0, amountDue - amountPaid);

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
      paidAt: null,
      attemptCount: txn.payments?.length ?? 0,
      paymentMethodType: null,
      cardLast4: null,
      lineItems: [],
      metadata: customData,
      raw,
    };
  }
}