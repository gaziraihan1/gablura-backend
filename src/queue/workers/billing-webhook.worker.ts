import { Worker, Job } from "bullmq";
import type { BillingWebhookRetryJobData } from "../queues/billing-webhook.queue.js";
import { prisma } from "../../lib/prisma.js";

const BILLING_WEBHOOK_WORKER_NAME = "billing-webhook-worker";

export function createBillingWebhookWorker() {
  const worker = new Worker(
    BILLING_WEBHOOK_WORKER_NAME,
    async (job: Job<BillingWebhookRetryJobData>) => {
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
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      concurrency: 2,
      stalledInterval: parseInt(process.env.BULLMQ_STALLED_INTERVAL_BILLING_WEBHOOK ?? "300000"), // 5 min (default: 30s) — billing retries are infrequent
      limiter: {
        max: 10,
        duration: 1000,
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(
      `[BillingWebhookWorker] Job ${job.id} completed for ${job.data.providerEventId}`,
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[BillingWebhookWorker] Job ${job?.id} failed for ${job?.data?.providerEventId}:`,
      err.message,
    );
  });

  return worker;
}
