import { Job } from "bullmq";
import type { PreComputeAnalyticsJobData, ComputeFocusStreakJobData } from "../queues/analytics.queue.js";
import { AnalyticsCache } from "../../lib/redis/cache.client.js";

/**
 * Processor for analytics jobs. Previously owned by a dedicated Worker
 * instance; now invoked by the consolidated jobs worker.
 */
export async function processAnalyticsJob(
  job: Job<PreComputeAnalyticsJobData | ComputeFocusStreakJobData>,
): Promise<void> {
  console.log(`[AnalyticsWorker] Processing ${job.name} job ${job.id}`);

  switch (job.name) {
    case "pre-compute-analytics": {
      const data = job.data as PreComputeAnalyticsJobData;
      // Invalidate analytics cache to force recomputation
      await AnalyticsCache.invalidateWorkspace(data.workspaceId);
      console.log(`[AnalyticsWorker] Invalidated analytics cache for workspace ${data.workspaceId}`);
      break;
    }

    case "compute-focus-streak": {
      const data = job.data as ComputeFocusStreakJobData;
      // This is a placeholder - actual implementation would compute focus streak
      console.log(`[AnalyticsWorker] Focus streak computation for user ${data.userId} (TODO: implement actual computation)`);
      break;
    }

    default:
      throw new Error(`Unknown analytics job name: ${job.name}`);
  }

  console.log(`[AnalyticsWorker] Completed ${job.name} job ${job.id}`);
}
