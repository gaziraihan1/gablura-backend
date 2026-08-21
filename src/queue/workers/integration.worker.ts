import { Worker, Job } from "bullmq";
import { IntegrationMutation } from "../../modules/integration/integration.mutation.js";
import type { SyncIntegrationJobData, ProcessWebhookJobData } from "../queues/integration.queue.js";

const INTEGRATION_WORKER_NAME = "integration-worker";

export function createIntegrationWorker() {
  const worker = new Worker(
    INTEGRATION_WORKER_NAME,
    async (job: Job<SyncIntegrationJobData | ProcessWebhookJobData>) => {
      console.log(`[IntegrationWorker] Processing ${job.name} job ${job.id}`);

      switch (job.name) {
        case "sync-integration": {
          const data = job.data as SyncIntegrationJobData;
          await IntegrationMutation.performSync(data.integrationId);
          console.log(`[IntegrationWorker] Synced integration ${data.integrationId}`);
          break;
        }

        case "process-webhook": {
          const data = job.data as ProcessWebhookJobData;
          await IntegrationMutation.processWebhookEvent(
            data.provider,
            data.integrationId,
            data.payload,
            data.signature,
            data.timestamp,
          );
          console.log(`[IntegrationWorker] Processed webhook for ${data.provider}`);
          break;
        }

        default:
          throw new Error(`Unknown integration job name: ${job.name}`);
      }

      console.log(`[IntegrationWorker] Completed ${job.name} job ${job.id}`);
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      concurrency: 3,
      stalledInterval: 120_000, // 2 min (default: 30s) — non-urgent, reduce Redis polling
      limiter: {
        max: 20,
        duration: 1000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[IntegrationWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[IntegrationWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
