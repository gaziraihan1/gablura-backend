import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const analyticsQueue = jobsQueue;

// Job data types
export interface PreComputeAnalyticsJobData {
  workspaceId: string;
  userId?: string;
}

export interface ComputeFocusStreakJobData {
  userId: string;
}

export async function addPreComputeAnalyticsJob(jobData: PreComputeAnalyticsJobData) {
  return jobsQueue.add("pre-compute-analytics", jobData, {
    priority: 5,
    attempts: 2,
    backoff: { type: "fixed", delay: 10000 },
    removeOnComplete: 5,
    removeOnFail: 2,
  });
}

export async function addComputeFocusStreakJob(jobData: ComputeFocusStreakJobData) {
  return jobsQueue.add("compute-focus-streak", jobData, {
    priority: 4,
    attempts: 2,
    backoff: { type: "fixed", delay: 10000 },
    removeOnComplete: 5,
    removeOnFail: 2,
  });
}
