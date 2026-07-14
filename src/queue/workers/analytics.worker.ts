import { Worker, Job } from "bullmq";
import type { PreComputeAnalyticsJobData, ComputeFocusStreakJobData } from "../queues/analytics.queue.js";
import { AnalyticsCache } from "../../lib/redis/cache.client.js";

const ANALYTICS_WORKER_NAME = "analytics-worker";

export function createAnalyticsWorker() {
  const worker = new Worker(
    ANALYTICS_WORKER_NAME,
    async (job: Job<PreComputeAnalyticsJobData | ComputeFocusStreakJobData>) => {
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
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[AnalyticsWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[AnalyticsWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
