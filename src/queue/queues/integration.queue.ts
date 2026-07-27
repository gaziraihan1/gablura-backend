import { Queue } from "bullmq";

const INTEGRATION_QUEUE_NAME = "integration";

export const integrationQueue = new Queue(INTEGRATION_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

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

export async function addSyncIntegrationJob(jobData: SyncIntegrationJobData) {
  return integrationQueue.add("sync-integration", jobData, {
    priority: 2,
  });
}

export async function addProcessWebhookJob(jobData: ProcessWebhookJobData) {
  return integrationQueue.add("process-webhook", jobData, {
    priority: 1,
  });
}
