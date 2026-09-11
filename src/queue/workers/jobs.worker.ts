import { Worker, Job } from "bullmq";
import { jobsQueue } from "../queues/jobs.queue.js";

import { processEmailJob } from "./email.worker.js";
import { processNotificationJob } from "./notification.worker.js";
import { processActivityJob } from "./activity.worker.js";
import { processCalendarJob } from "./calendar.worker.js";
import { processAnalyticsJob } from "./analytics.worker.js";
import { processIntegrationJob } from "./integration.worker.js";
import { processAutomationJob } from "./automation.worker.js";
import { processBillingWebhookJob } from "./billing-webhook.worker.js";

/**
 * Consolidated BullMQ worker.
 *
 * Previously the app ran 8 separate workers (email, notification, activity,
 * calendar, analytics, integration, automation, billing-webhook). Each
 * BullMQ Worker issues a blocking fetch (`brpoplpush`) that re-issues every
 * ~5 seconds even when fully idle → ~17,280 Redis commands/day per worker.
 * With 8 workers that was ~138k commands/day against Upstash with zero
 * traffic. ONE worker → ~17k/day (~85% reduction).
 *
 * Job names are all globally unique across the former queues, so a single
 * dispatch table by `job.name` preserves identical semantics.
 */
const JOBS_WORKER_NAME = "jobs-worker";

const HANDLERS: Record<string, (job: Job<any>) => Promise<unknown>> = {
  // email
  "send-admin-contact-notification": processEmailJob,
  "send-user-auto-reply": processEmailJob,
  "send-ban-email": processEmailJob,
  "send-workspace-deleted-email": processEmailJob,
  "send-workspace-limits-changed-email": processEmailJob,
  "send-invitation-email": processEmailJob,
  "send-data-export-email": processEmailJob,
  // notification
  "send-notification": processNotificationJob,
  "notify-task-assignees": processNotificationJob,
  "notify-workspace-members": processNotificationJob,
  // activity
  "log-activity": processActivityJob,
  "invalidate-cache": processActivityJob,
  "invalidate-cache-batch": processActivityJob,
  "update-storage-quota": processActivityJob,
  // calendar
  "compute-aggregates": processCalendarJob,
  "compute-insights": processCalendarJob,
  "pre-compute-user-calendar": processCalendarJob,
  // analytics
  "pre-compute-analytics": processAnalyticsJob,
  "compute-focus-streak": processAnalyticsJob,
  // integration
  "sync-integration": processIntegrationJob,
  "process-webhook": processIntegrationJob,
  // automation
  "automation-event": processAutomationJob,
  // billing-webhook
  "retry-webhook": processBillingWebhookJob,
};

export function createJobsWorker() {
  const worker = new Worker(
    JOBS_WORKER_NAME,
    async (job: Job<any>) => {
      const handler = HANDLERS[job.name];
      if (!handler) {
        throw new Error(`Unknown job name: ${job.name}`);
      }
      return handler(job);
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      // Covers the highest former per-queue concurrency (notification: 5).
      concurrency: 5,
      // 5 min (default: 30s) — stalled-check scripts run 288x/day instead of
      // 2,880x/day. Overridable via env. Falls back to legacy interval for backward compatibility.
      stalledInterval: parseInt(
        process.env.BULLMQ_STALLED_INTERVAL_JOBS ??
        process.env.BULLMQ_STALLED_INTERVAL_NOTIFICATION ??
        process.env.BULLMQ_STALLED_INTERVAL_EMAIL ??
        "300000"
      ),
      // Union of the former per-queue rate limiters (email: 10/s,
      // integration: 20/s, billing: 10/s) applied to the single queue.
      limiter: {
        max: 20,
        duration: 1000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[JobsWorker] Job ${job.name} (${job.id}) completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[JobsWorker] Job ${job?.name} (${job?.id}) failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[JobsWorker] Worker error:", err.message);
  });

  return worker;
}
