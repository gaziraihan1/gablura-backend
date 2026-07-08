import Stripe from "stripe";
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
  NormalisedEventType,
} from "../../IpaymentProvider.js";
import { BillingCycle } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL, ExternalApiCache } from "../../../lib/redis/cache.client.js";
// import { prisma } from "../../../index.js";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("[StripeProvider] STRIPE_SECRET_KEY is not set");
}

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-02-25.clover",
  typescript: true,
  maxNetworkRetries: 3,
  timeout: 10_000,
  telemetry: false,
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

type StripeSubscriptionExtended = Stripe.Subscription & {
  current_period_start: number;
  current_period_end: number;
};

type StripeInvoiceExtended = Stripe.Invoice & {
  payment_intent: string | Stripe.PaymentIntent | null;
  subscription: string | Stripe.Subscription | null;
};

function mapStatus(s: Stripe.Subscription.Status): NormalisedSubStatus {
  const map: Record<string, NormalisedSubStatus> = {
    trialing: "TRIALING",
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
    paused: "PAUSED",
    incomplete: "INCOMPLETE",
    incomplete_expired: "INCOMPLETE_EXPIRED",
  };
  return map[s] ?? "INCOMPLETE";
}

function mapInvoiceStatus(
  s: string | null | undefined,
): NormalisedInvoiceStatus {
  const map: Record<string, NormalisedInvoiceStatus> = {
    draft: "DRAFT",
    open: "OPEN",
    paid: "PAID",
    void: "VOID",
    uncollectible: "UNCOLLECTIBLE",
  };
  return map[s ?? ""] ?? "DRAFT";
}

function mapBillingCycle(price?: Stripe.Price): BillingCycle {
  return price?.recurring?.interval === "year" ? "YEARLY" : "MONTHLY";
}

async function resolvePlanNameFromPriceId(priceId: string): Promise<string> {
  const plan = await prisma.plan.findFirst({
    where: {
      OR: [{ stripePriceIdMonthly: priceId }, { stripePriceIdYearly: priceId }],
    },
  });
  return plan?.name ?? "FREE";
}

function extractLast4(pi: Stripe.PaymentIntent): string | null {
  return (
    (pi as any).charges?.data?.[0]?.payment_method_details?.card?.last4 ?? null
  );
}

function mapEventType(type: string): NormalisedEventType | null {
  const map: Record<string, NormalisedEventType> = {
    "checkout.session.completed": "CHECKOUT_COMPLETED",
    "customer.subscription.created": "SUBSCRIPTION_CREATED",
    "customer.subscription.updated": "SUBSCRIPTION_UPDATED",
    "customer.subscription.deleted": "SUBSCRIPTION_CANCELED",
    "customer.subscription.trial_will_end": "SUBSCRIPTION_TRIAL_ENDING",
    "invoice.payment_succeeded": "INVOICE_PAID",
    "invoice.payment_failed": "INVOICE_PAYMENT_FAILED",
    "invoice.created": "INVOICE_CREATED",
    "invoice.updated": "INVOICE_UPDATED",
  };
  return map[type] ?? null;
}

export class StripeProvider implements IPaymentProvider {
  readonly name = "stripe";

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    const cacheKey = CACHE_KEYS.stripeCustomer(`${params.email}`);
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const customer = await stripeClient.customers.create({
          email: params.email,
          name: params.name,
          metadata: params.metadata,
        });
        return { providerCustomerId: customer.id };
      },
      CACHE_TTL.EXTERNAL_API_STRIPE_CUSTOMER,
    );
  }

  async createCheckoutSession(
    params: CreateCheckoutParams,
  ): Promise<CheckoutResult> {
    // Checkout sessions are typically short-lived and specific to a session, 
    // so we don't cache the session URL itself, but we can cache the price lookup.
    const priceEnvKey = `STRIPE_PRICE_${params.planName}_${params.billingCycle}`;
    const priceId = process.env[priceEnvKey];

    if (!priceId) {
      throw new Error(
        `[StripeProvider] No price configured for env var: ${priceEnvKey}`,
      );
    }

    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: params.providerCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { workspaceId: params.workspaceId, ownerId: params.ownerId },
        trial_period_days: params.trialDays,
      },
      metadata: params.metadata,
    });

    return { url: session.url! };
  }

  async createPortalSession(params: CreatePortalParams): Promise<PortalResult> {
    // Portal sessions are also typically unique per request, but can be cached for a very short time
    const cacheKey = `api:stripe:portal:${params.providerCustomerId}`;
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const session = await stripeClient.billingPortal.sessions.create({
          customer: params.providerCustomerId,
          return_url: params.returnUrl,
        });
        return { url: session.url };
      },
      60, // 1 minute TTL for portal sessions
    );
  }

  async changePlan(params: ChangePlanParams): Promise<void> {
    const cacheKey = CACHE_KEYS.stripeSubscription(params.providerSubscriptionId);
    const sub = await CacheClient.getOrSet<Stripe.Subscription>(
      cacheKey,
      () => stripeClient.subscriptions.retrieve(params.providerSubscriptionId),
      CACHE_TTL.EXTERNAL_API_STRIPE_SUBSCRIPTION,
    );
    const itemId = sub.items.data[0]?.id;

    await stripeClient.subscriptions.update(params.providerSubscriptionId, {
      items: [{ id: itemId, price: params.newProviderPriceId }],
      proration_behavior: params.isUpgrade
        ? "always_invoice"
        : "create_prorations",
      metadata: params.metadata,
    });
    await ExternalApiCache.invalidateStripeSubscription(params.providerSubscriptionId);
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    if (params.immediately) {
      await stripeClient.subscriptions.cancel(params.providerSubscriptionId);
    } else {
      await stripeClient.subscriptions.update(params.providerSubscriptionId, {
        cancel_at_period_end: true,
        metadata: { cancelReason: params.reason ?? "" },
      });
    }
    await ExternalApiCache.invalidateStripeSubscription(params.providerSubscriptionId);
  }

  async reactivateSubscription(
    params: ReactivateSubscriptionParams,
  ): Promise<void> {
    await stripeClient.subscriptions.update(params.providerSubscriptionId, {
      cancel_at_period_end: false,
    });
    await ExternalApiCache.invalidateStripeSubscription(params.providerSubscriptionId);
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalisedSubscriptionEvent | NormalisedInvoiceEvent | null> {
    const sig = headers["stripe-signature"] as string;

    let event: Stripe.Event;
    try {
      event = stripeClient.webhooks.constructEvent(
        rawBody,
        sig,
        WEBHOOK_SECRET,
      );
    } catch (err) {
      throw new Error(
        `[StripeProvider] Webhook signature invalid: ${(err as Error).message}`,
      );
    }

    const eventType = mapEventType(event.type);
    if (!eventType) return null;

    const obj = event.data.object;

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.trial_will_end"
    ) {
      const sub = obj as StripeSubscriptionExtended;
      const priceId = sub.items.data[0]?.price.id;
      const planName =
        sub.metadata?.planName ?? (await resolvePlanNameFromPriceId(priceId));

      const normalised: NormalisedSubscriptionEvent = {
        type: eventType,
        providerEventId: event.id,
        providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer as string,
        providerPriceId: priceId,
        planName,
        status: mapStatus(sub.status),
        billingCycle: mapBillingCycle(sub.items.data[0]?.price),
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        metadata: (sub.metadata ?? {}) as Record<string, string>,
        raw: event,
      };

      return normalised;
    }

    if (event.type === "checkout.session.completed") {
      const session = obj as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return null;

      const normalised: NormalisedSubscriptionEvent = {
        type: "CHECKOUT_COMPLETED",
        providerEventId: event.id,
        providerSubscriptionId: (session.subscription as string) ?? "",
        providerCustomerId: (session.customer as string) ?? "",
        providerPriceId: "",
        planName: session.metadata?.planName ?? "",
        status: "INCOMPLETE",
        billingCycle:
          (session.metadata?.billingCycle as BillingCycle) ?? "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        metadata: (session.metadata ?? {}) as Record<string, string>,
        raw: event,
      };

      return normalised;
    }
    if (
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed" ||
      event.type === "invoice.created" ||
      event.type === "invoice.updated"
    ) {
      const inv = obj as StripeInvoiceExtended;

      let paymentMethodType: string | null = null;
      let cardLast4: string | null = null;

      if (event.type === "invoice.payment_succeeded" && inv.payment_intent) {
        const pi =
          typeof inv.payment_intent === "string"
            ? await stripeClient.paymentIntents.retrieve(inv.payment_intent)
            : (inv.payment_intent as Stripe.PaymentIntent);
        paymentMethodType = pi.payment_method_types?.[0] ?? null;
        cardLast4 = extractLast4(pi);
      }

      let subMetadata: Record<string, string> = {};
      if (inv.subscription) {
        const subId =
          typeof inv.subscription === "string"
            ? inv.subscription
            : (inv.subscription as Stripe.Subscription).id;
        const cacheKey = CACHE_KEYS.stripeSubscription(subId);
        const sub = await CacheClient.getOrSet<Stripe.Subscription>(
          cacheKey,
          () => stripeClient.subscriptions.retrieve(subId),
          CACHE_TTL.EXTERNAL_API_STRIPE_SUBSCRIPTION,
        );
        subMetadata = (sub.metadata ?? {}) as Record<string, string>;
      }

      const normalised: NormalisedInvoiceEvent = {
        type: eventType,
        providerEventId: event.id,
        providerInvoiceId: inv.id,
        providerCustomerId: inv.customer as string | null,
        providerSubscriptionId:
          typeof inv.subscription === "string"
            ? inv.subscription
            : ((inv.subscription as Stripe.Subscription)?.id ?? null),
        providerPaymentId:
          typeof inv.payment_intent === "string"
            ? inv.payment_intent
            : ((inv.payment_intent as Stripe.PaymentIntent)?.id ?? null),
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        amountRemaining: inv.amount_remaining,
        currency: inv.currency,
        status: mapInvoiceStatus(inv.status),
        invoiceNumber: inv.number ?? null,
        invoicePdfUrl: inv.invoice_pdf ?? null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        periodStart: inv.period_start
          ? new Date(inv.period_start * 1000)
          : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
        dueDate: inv.due_date ? new Date(inv.due_date * 1000) : null,
        paidAt: inv.status_transitions?.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000)
          : null,
        attemptCount: inv.attempt_count,
        paymentMethodType,
        cardLast4,
        lineItems: inv.lines?.data ?? null,
        metadata: { ...subMetadata, ...(inv.metadata ?? {}) } as Record<
          string,
          string
        >,
        raw: event,
      };

      return normalised;
    }

    return null;
  }
}
