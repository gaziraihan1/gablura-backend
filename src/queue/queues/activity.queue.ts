import { Queue } from "bullmq";

const ACTIVITY_QUEUE_NAME = "activity";

export const activityQueue = new Queue(ACTIVITY_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 500,
    },
    removeOnComplete: 50,
    removeOnFail: 25,
  },
});

// Job data types
export interface LogActivityJobData {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  taskId?: string;
  metadata?: Record<string, any>;
}

export interface InvalidateCacheJobData {
  type: "analytics" | "workspace" | "task" | "calendar" | "access-control" | "activity";
  workspaceId?: string;
  userId?: string;
  taskId?: string;
}

export interface UpdateStorageQuotaJobData {
  workspaceId: string;
  bytes: number;
  operation: "increment" | "decrement";
}

export async function addLogActivityJob(jobData: LogActivityJobData) {
  return activityQueue.add("log-activity", jobData, {
    priority: 5,
  });
}

export async function addInvalidateCacheJob(jobData: InvalidateCacheJobData) {
  return activityQueue.add("invalidate-cache", jobData, {
    priority: 3,
  });
}

export async function addUpdateStorageQuotaJob(jobData: UpdateStorageQuotaJobData) {
  return activityQueue.add("update-storage-quota", jobData, {
    priority: 4,
  });
}
