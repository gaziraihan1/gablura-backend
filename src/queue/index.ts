import { jobsQueue } from "./queues/jobs.queue.js";

import { createJobsWorker } from "./workers/jobs.worker.js";

import type { Worker } from "bullmq";

let worker: Worker | null = null;

export async function initQueueWorkers() {
  console.log("[Queue] Initializing consolidated queue worker...");

  worker = createJobsWorker();

  console.log("[Queue] Consolidated queue worker started (single worker consumes all job types)");
}

export async function closeQueueWorkers() {
  console.log("[Queue] Closing queue worker...");

  if (worker) {
    await worker.close();
    worker = null;
  }

  await jobsQueue.close();

  console.log("[Queue] Queue worker closed");
}

// Domain queue aliases — all point at the single unified queue instance.
// Kept as named exports so existing imports keep working.
export {
  jobsQueue,
  emailQueue,
  notificationQueue,
  activityQueue,
  calendarQueue,
  analyticsQueue,
  integrationQueue,
  automationQueue,
  billingWebhookQueue,
} from "./queues/reexports.js";

export {
  addSendEmailJob,
} from "./queues/email.queue.js";

export {
  addSendNotificationJob,
  addNotifyTaskAssigneesJob,
  addNotifyWorkspaceMembersJob,
} from "./queues/notification.queue.js";

export {
  addLogActivityJob,
  addInvalidateCacheJob,
  addBatchInvalidateCacheJob,
  addUpdateStorageQuotaJob,
} from "./queues/activity.queue.js";

export {
  addComputeAggregatesJob,
  addComputeInsightsJob,
  addPreComputeUserCalendarJob,
} from "./queues/calendar.queue.js";

export {
  addPreComputeAnalyticsJob,
  addComputeFocusStreakJob,
} from "./queues/analytics.queue.js";

export {
  addSyncIntegrationJob,
  addProcessWebhookJob,
} from "./queues/integration.queue.js";

export {
  addAutomationEventJob,
} from "./queues/automation.queue.js";

export {
  addBillingWebhookRetryJob,
} from "./queues/billing-webhook.queue.js";
