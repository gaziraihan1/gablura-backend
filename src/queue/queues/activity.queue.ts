import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const activityQueue = jobsQueue;

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

const ACTIVITY_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 500 },
  removeOnComplete: 25,
  removeOnFail: 12,
};

export async function addLogActivityJob(jobData: LogActivityJobData) {
  return jobsQueue.add("log-activity", jobData, {
    priority: 5,
    ...ACTIVITY_JOB_OPTS,
  });
}

export async function addInvalidateCacheJob(jobData: InvalidateCacheJobData) {
  return jobsQueue.add("invalidate-cache", jobData, {
    priority: 3,
    ...ACTIVITY_JOB_OPTS,
  });
}

/**
 * Batch cache invalidation — fires a single BullMQ job for multiple
 * invalidation types instead of one job per type. Reduces Redis commands
 * from N×3-5 to just 3-5 per mutation.
 *
 * @example
 *   addBatchInvalidateCacheJob([
 *     { type: 'analytics', workspaceId },
 *     { type: 'workspace', workspaceId },
 *     { type: 'task', taskId, userId, workspaceId },
 *   ]);
 */
export async function addBatchInvalidateCacheJob(jobs: InvalidateCacheJobData[]) {
  if (jobs.length === 0) return;
  if (jobs.length === 1) return addInvalidateCacheJob(jobs[0]);
  return jobsQueue.add("invalidate-cache-batch", { jobs }, {
    priority: 3,
    ...ACTIVITY_JOB_OPTS,
  });
}

export async function addUpdateStorageQuotaJob(jobData: UpdateStorageQuotaJobData) {
  return jobsQueue.add("update-storage-quota", jobData, {
    priority: 4,
    ...ACTIVITY_JOB_OPTS,
  });
}
