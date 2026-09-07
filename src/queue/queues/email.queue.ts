import { Queue } from "bullmq";

const EMAIL_QUEUE_NAME = "email";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES ?? "3"),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 50, // Reduced from 100 to reduce Redis memory usage
    removeOnFail: 25,    // Reduced from 50 to reduce Redis memory usage
  },
});

// Job data types
export interface SendEmailJobData {
  type: "admin-contact-notification" | "user-auto-reply" | "ban-email" | "workspace-deleted-email" | "workspace-limits-changed-email" | "invitation-email" | "data-export-email";
  to: string;
  subject?: string;
  data: Record<string, any>;
}

export async function addSendEmailJob(jobData: SendEmailJobData) {
  return emailQueue.add(`send-${jobData.type}`, jobData, {
    priority: jobData.type === "ban-email" ? 1 : 2,
  });
}
