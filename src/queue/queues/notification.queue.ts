import { Queue } from "bullmq";

const NOTIFICATION_QUEUE_NAME = "notification";

export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
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
      delay: 1000,
    },
    removeOnComplete: 100, // Reduced from 200 to reduce Redis memory usage
    removeOnFail: 50,     // Reduced from 100 to reduce Redis memory usage
  },
});

// Job data types
export interface SendNotificationJobData {
  userId: string;
  senderId?: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
}

export interface NotifyTaskAssigneesJobData {
  taskId: string;
  senderId: string;
  type: string;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export interface NotifyWorkspaceMembersJobData {
  workspaceId: string;
  senderId: string;
  type: string;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export async function addSendNotificationJob(jobData: SendNotificationJobData) {
  return notificationQueue.add("send-notification", jobData);
}

export async function addNotifyTaskAssigneesJob(jobData: NotifyTaskAssigneesJobData) {
  return notificationQueue.add("notify-task-assignees", jobData);
}

export async function addNotifyWorkspaceMembersJob(jobData: NotifyWorkspaceMembersJobData) {
  return notificationQueue.add("notify-workspace-members", jobData);
}
