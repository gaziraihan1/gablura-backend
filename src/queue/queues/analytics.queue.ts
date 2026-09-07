import { Queue } from "bullmq";

const ANALYTICS_QUEUE_NAME = "analytics";

export const analyticsQueue = new Queue(ANALYTICS_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES ?? "3"),
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 10000,
    },
    removeOnComplete: 5, // Reduced from 10 to reduce Redis memory usage
    removeOnFail: 2,    // Reduced from 5 to reduce Redis memory usage
  },
});

// Job data types
export interface PreComputeAnalyticsJobData {
  workspaceId: string;
  userId?: string;
}

export interface ComputeFocusStreakJobData {
  userId: string;
}

export async function addPreComputeAnalyticsJob(jobData: PreComputeAnalyticsJobData) {
  return analyticsQueue.add("pre-compute-analytics", jobData, {
    priority: 5,
  });
}

export async function addComputeFocusStreakJob(jobData: ComputeFocusStreakJobData) {
  return analyticsQueue.add("compute-focus-streak", jobData, {
    priority: 4,
  });
}
