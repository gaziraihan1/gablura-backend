// backend/src/payment/providers/lemonsqueezy/lemonsqueezy.provider.ts
//
// Lemon Squeezy payment provider implementation.
// Implements the IPaymentProvider interface to provide a seamless integration
// with Lemon Squeezy's subscription billing system.
//
// Key differences from Stripe/Paddle:
// - Lemon Squeezy uses "variants" instead of "price IDs"
// - Customer portal URLs are returned directly from subscription objects
// - Webhook signature verification uses HMAC-SHA256 with X-Signature header
// - Custom data is passed via checkout_data.custom in checkouts
// ─────────────────────────────────────────────────────────────────────────────

import { BillingCycle } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';

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
  NormalisedEventType,
} from '../../IpaymentProvider.js';

import {
  setupLemonSqueezy,
  getLemonSqueezyStoreId,
  getLemonSqueezyWebhookSecret,
  LEMONSQUEEZY_VARIANT_TO_PLAN,
  resolveLemonSqueezyVariantId,
  createCustomer as lsCreateCustomer,
  createCheckout as lsCreateCheckout,
  getCustomer as lsGetCustomer,
  getSubscription as lsGetSubscription,
  updateSubscription as lsUpdateSubscription,
  cancelSubscription as lsCancelSubscription,
} from '../../../modules/billing/config/lemonsqueezy.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL, ExternalApiCache } from '../../../lib/redis/cache.client.js';

// ---------------------------------------------------------------------------
// Types — Lemon Squeezy webhook payload structure
// ---------------------------------------------------------------------------

interface LemonSqueezyMeta {
  event_name: string;
  custom_data?: Record<string, string>;
  test_mode?: boolean;
  webhook_id?: number;
}

interface LemonSqueezySubscriptionAttributes {
  store_id: number;
  customer_id: number;
  order_id: number;
  order_item_id: number;
  product_id: number;
  variant_id: number;
  product_name: string;
  variant_name: string;
  user_name: string;
  user_email: string;
  status: string;
  status_formatted: string;
  card_brand: string;
  card_last_four: string;
  payment_processor: string;
  pause: {
    mode: string;
    resumes_at: string | null;
  } | null;
  cancelled: boolean;
  trial_ends_at: string | null;
  billing_anchor: number | null;
  first_subscription_item: {
    id: number;
    subscription_id: number;
    price_id: number;
    quantity: number;
  } | null;
  urls: {
    update_payment_method: string;
    customer_portal: string;
    customer_portal_update_subscription: string | null;
  };
  renews_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  test_mode: boolean;
}

interface LemonSqueezySubscriptionEvent {
  meta: LemonSqueezyMeta;
  type: string;
  id: string;
  attributes: LemonSqueezySubscriptionAttributes;
}

interface LemonSqueezyOrderAttributes {
  store_id: number;
  customer_id: number;
  identifier: string;
  order_number: number;
  user_name: string;
  user_email: string;
  currency: string;
  currency_rate: string;
  subtotal: number;
  discount_total: number;
  tax: number;
  total: number;
  refund_total: number;
  subtotal_usd: number;
  discount_total_usd: number;
  tax_usd: number;
  total_usd: number;
  refund_total_usd: number;
  created_at: string;
  updated_at: string;
  test_mode: boolean;
  status: string;
  status_formatted: string;
  refund_url: string | null;
  order_number_formatted: string;
}

interface LemonSqueezyOrderEvent {
  meta: LemonSqueezyMeta;
  type: string;
  id: string;
  attributes: LemonSqueezyOrderAttributes;
}

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

function mapSubStatus(status: string): NormalisedSubStatus {
  const map: Record<string, NormalisedSubStatus> = {
    active: 'ACTIVE',
    on_trial: 'TRIALING',
    past_due: 'PAST_DUE',
    paused: 'PAUSED',
    cancelled: 'CANCELED',
    expired: 'CANCELED',
    unpaid: 'UNPAID',
  };
  return map[status] ?? 'INCOMPLETE';
}

function mapInvoiceStatus(status: string): NormalisedInvoiceStatus {
  const map: Record<string, NormalisedInvoiceStatus> = {
    draft: 'DRAFT',
    open: 'OPEN',
    paid: 'PAID',
    void: 'VOID',
    pending: 'OPEN',
    failed: 'UNCOLLECTIBLE',
    paid_pending: 'PAID',
  };
  return map[status] ?? 'DRAFT';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value?: string | null, fallback = new Date()): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

/**
 * Verify Lemon Squeezy webhook signature using HMAC-SHA256.
 * The signature is sent in the X-Signature header.
 */
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Reject non-hex signatures — Buffer.from('not-hex', 'hex') produces an
  // empty buffer which would pass timingSafeEqual against another empty buffer.
  if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length !== 64) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Resolve plan name from variant ID using the reverse mapping.
 */
function resolvePlanNameFromVariantId(variantId: string): string {
  const mapping = LEMONSQUEEZY_VARIANT_TO_PLAN.get(String(variantId));
  return mapping?.planName ?? '';
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LemonSqueezyProvider implements IPaymentProvider {
  readonly name = 'lemonsqueezy';

  constructor() {
    // Ensure SDK is configured when the provider is instantiated
    setupLemonSqueezy();
  }

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    const storeId = getLemonSqueezyStoreId();
    const cacheKey = CACHE_KEYS.lemonSqueezyCustomer(params.email);

    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const response = await lsCreateCustomer(storeId, {
          name: params.name ?? '',
          email: params.email,
        });

        if (response.error) {
          throw new Error(`[LemonSqueezyProvider] Failed to create customer: ${response.error.message}`);
        }

        const customerId = response.data?.data?.id;
        if (!customerId) {
          throw new Error('[LemonSqueezyProvider] No customer ID returned');
        }

        return { providerCustomerId: String(customerId) };
      },
      CACHE_TTL.EXTERNAL_API_LEMONSQUEEZY_CUSTOMER,
    );
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const storeId = getLemonSqueezyStoreId();

    const variantId = resolveLemonSqueezyVariantId(
      params.planName,
      params.billingCycle,
    );

    // Determine if trial should be skipped
    const skipTrial = !params.trialDays || params.trialDays <= 0;

    const response = await lsCreateCheckout(storeId, variantId, {
      productOptions: {
        redirectUrl: params.successUrl,
        enabledVariants: [variantId as unknown as number],
      },
      checkoutOptions: {
        embed: false,
        media: true,
        logo: true,
        desc: true,
        discount: true,
        subscriptionPreview: true,
        skipTrial,
      },
      checkoutData: {
        custom: {
          workspaceId: params.workspaceId,
          ownerId: params.ownerId,
          planName: params.planName,
          billingCycle: params.billingCycle,
        },
      },
    });

    if (response.error) {
      throw new Error(`[LemonSqueezyProvider] Failed to create checkout: ${response.error.message}`);
    }

    const url = response.data?.data?.attributes?.url;
    if (!url) {
      throw new Error('[LemonSqueezyProvider] No checkout URL returned');
    }

    return { url };
  }

  async createPortalSession(params: CreatePortalParams): Promise<PortalResult> {
    const cacheKey = `api:lemonsqueezy:portal:${params.providerCustomerId}`;

    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const response = await lsGetCustomer(Number(params.providerCustomerId));

        if (response.error) {
          throw new Error(`[LemonSqueezyProvider] Failed to get customer: ${response.error.message}`);
        }

        const portalUrl = response.data?.data?.attributes?.urls?.customer_portal;
        if (!portalUrl) {
          throw new Error('[LemonSqueezyProvider] No customer portal URL available');
        }

        return { url: portalUrl };
      },
      60, // 1 minute TTL for portal sessions (URLs expire in 24h but we refresh)
    );
  }

  async changePlan(params: ChangePlanParams): Promise<void> {
    const cacheKey = CACHE_KEYS.lemonSqueezySubscription(params.providerSubscriptionId);

    // Get the subscription to verify it exists
    const sub = await CacheClient.getOrSet(
      cacheKey,
      async () => {
        const response = await lsGetSubscription(Number(params.providerSubscriptionId));
        if (response.error) throw response.error;
        return response;
      },
      CACHE_TTL.EXTERNAL_API_LEMONSQUEEZY_SUBSCRIPTION,
    );

    if (!sub?.data?.data) {
      throw new Error(`[LemonSqueezyProvider] Subscription not found: ${params.providerSubscriptionId}`);
    }

    // Update the subscription to the new variant
    const response = await lsUpdateSubscription(Number(params.providerSubscriptionId), {
      variantId: params.newProviderPriceId as unknown as number,
      invoiceImmediately: params.isUpgrade,
    });

    if (response.error) {
      throw new Error(`[LemonSqueezyProvider] Failed to update subscription: ${response.error.message}`);
    }

    await ExternalApiCache.invalidateLemonSqueezySubscription(params.providerSubscriptionId);
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    // Lemon Squeezy only supports end-of-period cancellation (no effectiveFrom
    // parameter like Paddle/Stripe). Calling cancelSubscription() on LS marks
    // the subscription to be cancelled at the end of the current billing period.
    //
    // When immediately=true, the billing service optimistically downgrades the
    // workspace in the DB right away. The LS webhook (subscription_cancelled)
    // fires at period end to confirm. This matches the Stripe/Paddle UX: the
    // user loses access immediately in our system, even though the provider
    // subscription technically remains active until period end.
    const response = await lsCancelSubscription(Number(params.providerSubscriptionId));

    if (response.error) {
      throw new Error(`[LemonSqueezyProvider] Failed to cancel subscription: ${response.error.message}`);
    }

    await ExternalApiCache.invalidateLemonSqueezySubscription(params.providerSubscriptionId);
  }

  async reactivateSubscription(params: ReactivateSubscriptionParams): Promise<void> {
    // Lemon Squeezy resume: set cancelled=false on a subscription in grace period
    const response = await lsUpdateSubscription(Number(params.providerSubscriptionId), {
      cancelled: false,
    });

    if (response.error) {
      throw new Error(`[LemonSqueezyProvider] Failed to reactivate subscription: ${response.error.message}`);
    }

    await ExternalApiCache.invalidateLemonSqueezySubscription(params.providerSubscriptionId);
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
    const signature = headers['x-signature'];
    const sigStr = Array.isArray(signature) ? signature[0] : signature;

    if (!sigStr) {
      throw new Error('[LemonSqueezyProvider] Missing signature');
    }

    const secret = getLemonSqueezyWebhookSecret();
    const rawString = rawBody.toString('utf-8');

    // Verify HMAC signature
    if (!verifySignature(rawString, sigStr, secret)) {
      throw new Error('[LemonSqueezyProvider] Invalid webhook signature');
    }

    // Parse the webhook payload
    let payload: LemonSqueezySubscriptionEvent | LemonSqueezyOrderEvent;
    try {
      payload = JSON.parse(rawString);
    } catch (err) {
      throw new Error(`[LemonSqueezyProvider] Invalid JSON payload: ${(err as Error).message}`, { cause: err });
    }

    const eventName = payload.meta?.event_name;
    if (!eventName) {
      throw new Error('[LemonSqueezyProvider] Missing event_name in webhook payload');
    }

    // Extract custom data from meta
    const customData = payload.meta.custom_data ?? {};

    // Route based on event type
    switch (eventName) {
      // Subscription events
      case 'subscription_created':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_CREATED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_updated':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_UPDATED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_cancelled':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_CANCELED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_resumed':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_ACTIVATED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_expired':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_CANCELED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_paused':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_PAUSED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_unpaused':
        return this.normaliseSubscriptionEvent('SUBSCRIPTION_RESUMED', payload as LemonSqueezySubscriptionEvent, customData);

      // Payment events (map to invoice events)
      case 'subscription_payment_success':
        return this.normalisePaymentEvent('INVOICE_PAID', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_payment_failed':
        return this.normalisePaymentEvent('INVOICE_PAYMENT_FAILED', payload as LemonSqueezySubscriptionEvent, customData);
      case 'subscription_payment_recovered':
        return this.normalisePaymentEvent('INVOICE_PAID', payload as LemonSqueezySubscriptionEvent, customData);

      // Order events (also map to invoice events for consistency)
      case 'order_created':
        return this.normaliseOrderEvent('INVOICE_CREATED', payload as LemonSqueezyOrderEvent, customData);
      case 'order_refunded':
        return this.normaliseRefundEvent('REFUND_CREATED', payload as LemonSqueezyOrderEvent, customData);

      // Ignored events
      case 'customer_updated':
      case 'license_key_created':
      case 'license_key_updated':
      case 'affiliate_activated':
        return null;

      default:
        console.log(`[LemonSqueezyProvider] Unhandled event: ${eventName}`);
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private normalisation helpers
  // ---------------------------------------------------------------------------

  private normaliseSubscriptionEvent(
    type: NormalisedEventType,
    event: LemonSqueezySubscriptionEvent,
    customData: Record<string, string>,
  ): NormalisedSubscriptionEvent {
    const sub = event.attributes;
    const variantId = String(sub.variant_id);

    // Log if workspaceId is missing from customData
    if (!customData.workspaceId) {
      console.error('[LemonSqueezyProvider] Subscription event missing workspaceId in customData:', {
        subscriptionId: event.id,
        customDataKeys: Object.keys(customData),
        customData,
      });
    }

    const planName = resolvePlanNameFromVariantId(variantId) || customData.planName || 'PRO';

    // Determine billing cycle from variant mapping or default to MONTHLY
    const variantMapping = LEMONSQUEEZY_VARIANT_TO_PLAN.get(variantId);
    const billingCycle = variantMapping?.cycle ?? (customData.billingCycle as BillingCycle) ?? 'MONTHLY';

    // Trial end date
    const trialEnd = sub.status === 'on_trial' && sub.trial_ends_at
      ? toDate(sub.trial_ends_at)
      : null;

    // Calculate period boundaries from renews_at (next renewal date).
    // Lemon Squeezy only provides renews_at, not current_period_start.
    // We estimate the start by subtracting one billing interval from renews_at.
    const renewDate = sub.renews_at ? toDate(sub.renews_at) : null;
    const billingIntervalMs = billingCycle === 'YEARLY'
      ? 365 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd = renewDate ?? new Date(Date.now() + billingIntervalMs);
    const currentPeriodStart = renewDate
      ? new Date(renewDate.getTime() - billingIntervalMs)
      : new Date();

    return {
      type,
      providerEventId: `ls_${event.id}_${eventNameToSuffix(type)}`,
      providerSubscriptionId: event.id,
      providerCustomerId: String(sub.customer_id),
      providerPriceId: variantId,
      planName,
      status: mapSubStatus(sub.status),
      billingCycle,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelled,
      canceledAt: sub.ends_at ? toDate(sub.ends_at) : null,
      trialStart: sub.status === 'on_trial' ? toDate(sub.created_at) : null,
      trialEnd,
      metadata: customData,
      raw: event,
    };
  }

  private normalisePaymentEvent(
    type: NormalisedEventType,
    event: LemonSqueezySubscriptionEvent,
    customData: Record<string, string>,
  ): NormalisedInvoiceEvent {
    const sub = event.attributes;

    // Lemon Squeezy subscription_payment_* events do not include payment
    // amounts directly.  We set a sentinel of 0 — the webhook handler will
    // still create the invoice/payment record so the event is not lost.
    // If the associated order_webhook has already arrived, the invoice
    // row will be updated with real amounts when the order_created event
    // is processed.
    return {
      type,
      providerEventId: `ls_${event.id}_payment`,
      providerInvoiceId: `ls_inv_${event.id}_${sub.order_id}`,
      providerCustomerId: String(sub.customer_id),
      providerSubscriptionId: event.id,
      providerPaymentId: `ls_pay_${sub.order_id}`,
      amountDue: 0,
      amountPaid: 0,
      amountRemaining: 0,
      currency: 'usd',
      status: type === 'INVOICE_PAID' ? 'PAID' : 'UNCOLLECTIBLE',
      invoiceNumber: String(sub.order_id),
      invoicePdfUrl: null,
      hostedInvoiceUrl: null,
      periodStart: sub.renews_at ? toDate(sub.renews_at) : null,
      periodEnd: sub.renews_at ? toDate(sub.renews_at) : null,
      dueDate: null,
      paidAt: type === 'INVOICE_PAID' ? new Date() : null,
      attemptCount: 1,
      paymentMethodType: sub.payment_processor ?? null,
      cardLast4: sub.card_last_four ?? null,
      lineItems: [],
      metadata: customData,
      raw: event,
    };
  }

  private normaliseOrderEvent(
    type: NormalisedEventType,
    event: LemonSqueezyOrderEvent,
    customData: Record<string, string>,
  ): NormalisedInvoiceEvent {
    const order = event.attributes;

    // For subscription orders, the subscription_id may be present in custom_data
    // (injected during checkout). If not, the webhook handler will fall back to
    // metadata-based workspace resolution.
    const subscriptionId = customData.subscriptionId ?? null;

    return {
      type,
      providerEventId: `ls_${event.id}_order`,
      providerInvoiceId: order.identifier ?? String(order.order_number),
      providerCustomerId: String(order.customer_id),
      providerSubscriptionId: subscriptionId,
      providerPaymentId: order.identifier,
      amountDue: order.total,
      amountPaid: order.total - order.refund_total,
      amountRemaining: order.refund_total,
      currency: order.currency?.toLowerCase() ?? 'usd',
      status: mapInvoiceStatus(order.status),
      invoiceNumber: order.order_number_formatted ?? String(order.order_number),
      invoicePdfUrl: null,
      hostedInvoiceUrl: null,
      periodStart: null,
      periodEnd: null,
      dueDate: null,
      paidAt: order.status === 'paid' ? toDate(order.created_at) : null,
      attemptCount: 1,
      paymentMethodType: null,
      cardLast4: null,
      lineItems: [],
      metadata: customData,
      raw: event,
    };
  }

  private normaliseRefundEvent(
    type: NormalisedRefundEvent['type'],
    event: LemonSqueezyOrderEvent,
    customData: Record<string, string>,
  ): NormalisedRefundEvent {
    const order = event.attributes;

    return {
      type,
      providerEventId: `ls_${event.id}_refund`,
      providerRefundId: `ls_refund_${event.id}`,
      providerTransactionId: order.identifier ?? null,
      providerSubscriptionId: null,
      providerCustomerId: String(order.customer_id),
      action: 'refund',
      status: 'approved',
      amount: order.refund_total,
      currency: order.currency?.toLowerCase() ?? 'usd',
      metadata: customData,
      raw: event,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventNameToSuffix(type: NormalisedEventType): string {
  const map: Record<string, string> = {
    SUBSCRIPTION_CREATED: 'created',
    SUBSCRIPTION_UPDATED: 'updated',
    SUBSCRIPTION_CANCELED: 'cancelled',
    SUBSCRIPTION_ACTIVATED: 'activated',
    SUBSCRIPTION_PAUSED: 'paused',
    SUBSCRIPTION_RESUMED: 'resumed',
  };
  return map[type] ?? 'unknown';
}
