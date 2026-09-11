import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const billingWebhookQueue = jobsQueue;

// Job data type
export interface BillingWebhookRetryJobData {
  /** The provider event ID for idempotency */
  providerEventId: string;
  /** The raw webhook body as a string (re-verification will fail, but we need it for audit) */
  rawBody: string;
  /** The provider name that originally processed this */
  providerName: string;
  /** The original error message that caused the retry */
  originalError: string;
  /** Number of times this has been retried via queue (separate from BullMQ attempts) */
  retryCount: number;
}

/**
 * Enqueue a failed billing webhook event for background retry.
 * The worker will attempt to re-process it with exponential backoff.
 */
export async function addBillingWebhookRetryJob(
  jobData: BillingWebhookRetryJobData,
) {
  // Cap retries at 5 to prevent infinite loops
  if (jobData.retryCount >= 5) {
    console.error(
      `[BillingWebhook] Max retries (5) reached for event ${jobData.providerEventId}, giving up`,
    );
    return null;
  }

  return jobsQueue.add("retry-webhook", jobData, {
    delay: 10000 * Math.pow(2, jobData.retryCount), // 10s, 20s, 40s, 80s, 160s
    priority: 1,
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 25,
  });
}
