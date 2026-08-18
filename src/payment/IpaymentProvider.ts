import { BillingCycle } from "@prisma/client";

export interface CreateCheckoutParams {
  workspaceId: string;
  ownerId: string;
  providerCustomerId: string; // resolved before calling — Stripe customer ID or Paddle customer ID
  planName: string;
  billingCycle: BillingCycle;
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface CreatePortalParams {
  providerCustomerId: string;
  returnUrl: string;
}

export interface ChangePlanParams {
  providerSubscriptionId: string;
  newProviderPriceId: string;
  isUpgrade: boolean; // controls proration behaviour
  metadata: Record<string, string>;
}

export interface CancelSubscriptionParams {
  providerSubscriptionId: string;
  immediately: boolean;
  reason?: string;
}

export interface ReactivateSubscriptionParams {
  providerSubscriptionId: string;
}

export interface CreateCustomerParams {
  email: string;
  name?: string;
  metadata: Record<string, string>;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalResult {
  url: string;
}

export interface CustomerResult {
  providerCustomerId: string;
}

export type NormalisedEventType =
  | "CHECKOUT_COMPLETED"
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_UPDATED"
  | "SUBSCRIPTION_CANCELED"
  | "SUBSCRIPTION_TRIAL_ENDING" // Stripe: customer.subscription.trial_will_end
  | "SUBSCRIPTION_TRIAL_STARTED" // Paddle: subscription.trialing (trial begins)
  | "SUBSCRIPTION_ACTIVATED" // Paddle: subscription.activated (trial → active, or reactivated)
  | "SUBSCRIPTION_PAUSED" // Paddle: subscription.paused
  | "SUBSCRIPTION_RESUMED" // Paddle: subscription.resumed
  | "SUBSCRIPTION_PAST_DUE" // Paddle: subscription.past_due (payment failure escalated)
  | "INVOICE_PAID"
  | "INVOICE_PAYMENT_FAILED"
  | "INVOICE_CREATED"
  | "INVOICE_UPDATED"
  | "REFUND_CREATED"
  | "REFUND_UPDATED";

export interface NormalisedSubscriptionEvent {
  type: NormalisedEventType;
  providerEventId: string; // for idempotency (Stripe event.id / Paddle event_id)
  providerSubscriptionId: string | null; // null when checkout.session.completed fires before subscription exists
  providerCustomerId: string;
  providerPriceId: string;
  planName: string; // resolved from price ID
  status: NormalisedSubStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  metadata: Record<string, string>; // must contain workspaceId + ownerId
  raw: unknown; // original payload (stored in BillingEvent)
}

export interface NormalisedInvoiceEvent {
  type: NormalisedEventType;
  providerEventId: string;
  providerInvoiceId: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPaymentId: string | null;
  amountDue: number; // cents
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  status: NormalisedInvoiceStatus;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
  hostedInvoiceUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  attemptCount: number;
  paymentMethodType: string | null;
  cardLast4: string | null;
  lineItems: unknown;
  metadata: Record<string, string>;
  raw: unknown;
}

/**
 * A refund/chargeback (or its reversal) reported by the payment provider.
 * Paddle reports refunds as adjustments (`adjustment.created` /
 * `adjustment.updated`) against a transaction.
 */
export interface NormalisedRefundEvent {
  type: "REFUND_CREATED" | "REFUND_UPDATED";
  providerEventId: string; // for idempotency (Paddle event_id)
  providerRefundId: string; // Paddle adjustment ID (adj_xxx)
  providerTransactionId: string | null; // transaction that was refunded (txn_xxx)
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  action: string; // credit | refund | chargeback | ..._reverse
  status: string; // approved | pending_approval | rejected | reversed
  amount: number; // |adjustment total| in minor units (cents)
  currency: string;
  metadata: Record<string, string>;
  raw: unknown;
}

export type NormalisedSubStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "UNPAID"
  | "PAUSED"
  | "INCOMPLETE"
  | "INCOMPLETE_EXPIRED";

export type NormalisedInvoiceStatus =
  | "DRAFT"
  | "OPEN"
  | "PAID"
  | "VOID"
  | "UNCOLLECTIBLE";

export interface IPaymentProvider {
  readonly name: string; // 'stripe' | 'paddle' — stored in BillingEvent for debugging

  createCustomer(params: CreateCustomerParams): Promise<CustomerResult>;

  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult>;

  createPortalSession(params: CreatePortalParams): Promise<PortalResult>;

  changePlan(params: ChangePlanParams): Promise<void>;
  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;
  reactivateSubscription(params: ReactivateSubscriptionParams): Promise<void>;

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<
    | NormalisedSubscriptionEvent
    | NormalisedInvoiceEvent
    | NormalisedRefundEvent
    | null
  >;
}
