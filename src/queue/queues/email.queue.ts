import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
// All domain queues now share ONE physical BullMQ queue ("jobs").
export const emailQueue = jobsQueue;

// Job data types
export interface SendEmailJobData {
  type: "admin-contact-notification" | "user-auto-reply" | "ban-email" | "workspace-deleted-email" | "workspace-limits-changed-email" | "invitation-email" | "data-export-email";
  to: string;
  subject?: string;
  data: Record<string, any>;
}

export async function addSendEmailJob(jobData: SendEmailJobData) {
  return jobsQueue.add(`send-${jobData.type}`, jobData, {
    priority: jobData.type === "ban-email" ? 1 : 2,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}
