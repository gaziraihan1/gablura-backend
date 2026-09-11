import { Job } from "bullmq";
import { IntegrationMutation } from "../../modules/integration/integration.mutation.js";
import type { SyncIntegrationJobData, ProcessWebhookJobData } from "../queues/integration.queue.js";

/**
 * Processor for integration sync/webhook jobs. Previously owned by a
 * dedicated Worker instance; now invoked by the consolidated jobs worker.
 */
export async function processIntegrationJob(
  job: Job<SyncIntegrationJobData | ProcessWebhookJobData>,
): Promise<void> {
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
}
