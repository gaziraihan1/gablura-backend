import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const integrationQueue = jobsQueue;

// Job data types
export interface SyncIntegrationJobData {
  integrationId: string;
  userId: string;
}

export interface ProcessWebhookJobData {
  provider: string;
  integrationId: string;
  payload: any;
  signature?: string;
  timestamp?: string;
}

const INTEGRATION_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 25,
};

export async function addSyncIntegrationJob(jobData: SyncIntegrationJobData) {
  return jobsQueue.add("sync-integration", jobData, {
    priority: 2,
    ...INTEGRATION_JOB_OPTS,
  });
}

export async function addProcessWebhookJob(jobData: ProcessWebhookJobData) {
  return jobsQueue.add("process-webhook", jobData, {
    priority: 1,
    ...INTEGRATION_JOB_OPTS,
  });
}
