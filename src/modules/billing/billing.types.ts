import { BillingCycle, SubStatus } from '@prisma/client';

export interface CreateCheckoutInput {
  workspaceId:  string;
  workspaceSlug: string;
  ownerId:      string;  // must be workspace owner
  planName:     'PRO' | 'BUSINESS';
  billingCycle: BillingCycle;
}

export interface CreatePortalInput {
  workspaceId: string;
  workspaceSlug: string;
  ownerId:     string;
}

export interface CancelSubscriptionInput {
  workspaceId:  string;
  ownerId:      string;
  immediately?: boolean;
  reason?:      string;
}

export interface ChangePlanInput {
  workspaceId:   string;
  ownerId:       string;
  newPlanName:   'FREE' | 'PRO' | 'BUSINESS';
  billingCycle?: BillingCycle;
}

export interface WorkspaceSubscriptionResponse {
  workspaceId:          string;
  planName:             string;
  status:               SubStatus;
  billingCycle:         BillingCycle;
  currentPeriodEnd:     Date;
  cancelAtPeriodEnd:    boolean;
  trialEnd:             Date | null;
  stripeSubscriptionId: string;
}

export interface InvoiceResponse {
  id:             string;
  amount:         number;
  amountRefunded: number;
  refundedAt:     Date | null;
  currency:       string;
  status:         string;
  pdfUrl:         string | null;
  hostedUrl:      string | null;
  invoiceNumber:  string | null;
  periodStart:    Date | null;
  periodEnd:      Date | null;
  paidAt:         Date | null;
  createdAt:      Date;
}