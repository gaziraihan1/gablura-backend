import { Queue } from "bullmq";

const CALENDAR_QUEUE_NAME = "calendar";

export const calendarQueue = new Queue(CALENDAR_QUEUE_NAME, {
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
      delay: 5000,
    },
    removeOnComplete: 10, // Reduced from 20 to reduce Redis memory usage
    removeOnFail: 5,     // Reduced from 10 to reduce Redis memory usage
  },
});

// Job data types
export interface ComputeAggregatesJobData {
  userId: string;
  workspaceId?: string;
  startDate: string;
  endDate: string;
}

export interface ComputeInsightsJobData {
  userId: string;
  workspaceId?: string;
  startDate: string;
  endDate: string;
}

export interface PreComputeUserCalendarJobData {
  userId: string;
  workspaceId?: string;
}

export async function addComputeAggregatesJob(jobData: ComputeAggregatesJobData) {
  return calendarQueue.add("compute-aggregates", jobData, {
    priority: 2,
  });
}

export async function addComputeInsightsJob(jobData: ComputeInsightsJobData) {
  return calendarQueue.add("compute-insights", jobData, {
    priority: 3,
  });
}

export async function addPreComputeUserCalendarJob(jobData: PreComputeUserCalendarJobData) {
  return calendarQueue.add("pre-compute-user-calendar", jobData, {
    priority: 4,
  });
}
