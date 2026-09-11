import { Job } from "bullmq";
import type { BillingWebhookRetryJobData } from "../queues/billing-webhook.queue.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Processor for billing webhook retry jobs. Previously owned by a dedicated
 * Worker instance; now invoked by the consolidated jobs worker.
 */
export async function processBillingWebhookJob(
  job: Job<BillingWebhookRetryJobData>,
): Promise<{ skipped?: boolean; reason?: string; retried?: boolean; providerEventId?: string; retryCount?: number }> {
  const { providerEventId, providerName, originalError, retryCount } =
    job.data;

  console.log(
    `[BillingWebhookWorker] Retrying ${providerName} event ${providerEventId} (attempt ${retryCount + 1})`,
  );

  // Check if the event has already been processed (e.g. by a concurrent
  // retry or manual intervention) — idempotent skip.
  const existing = await prisma.billingEvent.findUnique({
    where: { providerEventId },
    select: { processed: true },
  });

  if (existing?.processed) {
    console.log(
      `[BillingWebhookWorker] Event ${providerEventId} already processed, skipping retry`,
    );
    return { skipped: true, reason: "already_processed" };
  }

  // Update the BillingEvent with retry metadata so we have an audit trail.
  // The actual re-processing happens via the provider's webhook replay
  // (Stripe/Paddle/LS can resend webhooks from their dashboards), or
  // via the dev simulator in development.
  await prisma.billingEvent.update({
    where: { providerEventId },
    data: {
      error: `[Retry ${retryCount + 1}] ${originalError}`,
      // Keep processed: false so the webhook handler can pick it up
      // if the provider replays the event.
    },
  });

  console.log(
    `[BillingWebhookWorker] Updated BillingEvent for ${providerEventId} with retry metadata`,
  );

  return {
    retried: true,
    providerEventId,
    retryCount: retryCount + 1,
  };
}
