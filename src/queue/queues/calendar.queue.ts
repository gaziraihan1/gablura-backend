import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const calendarQueue = jobsQueue;

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

const CALENDAR_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 5000 },
  removeOnComplete: 10,
  removeOnFail: 5,
};

export async function addComputeAggregatesJob(jobData: ComputeAggregatesJobData) {
  return jobsQueue.add("compute-aggregates", jobData, {
    priority: 2,
    ...CALENDAR_JOB_OPTS,
  });
}

export async function addComputeInsightsJob(jobData: ComputeInsightsJobData) {
  return jobsQueue.add("compute-insights", jobData, {
    priority: 3,
    ...CALENDAR_JOB_OPTS,
  });
}

export async function addPreComputeUserCalendarJob(jobData: PreComputeUserCalendarJobData) {
  return jobsQueue.add("pre-compute-user-calendar", jobData, {
    priority: 4,
    ...CALENDAR_JOB_OPTS,
  });
}
