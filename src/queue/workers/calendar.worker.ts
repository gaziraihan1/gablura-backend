import { Worker, Job } from "bullmq";
import type { ComputeAggregatesJobData, ComputeInsightsJobData, PreComputeUserCalendarJobData } from "../queues/calendar.queue.js";
import { CalendarCache } from "../../lib/redis/cache.client.js";
import { CalendarAggregation } from "../../modules/calendar/calendar.aggregation.js";
import { CalendarInsightsService } from "../../modules/calendar/calendar.insights.js";

const CALENDAR_WORKER_NAME = "calendar-worker";

export function createCalendarWorker() {
  const worker = new Worker(
    CALENDAR_WORKER_NAME,
    async (job: Job<ComputeAggregatesJobData | ComputeInsightsJobData | PreComputeUserCalendarJobData>) => {
      console.log(`[CalendarWorker] Processing ${job.name} job ${job.id}`);

      switch (job.name) {
        case "compute-aggregates": {
          const data = job.data as ComputeAggregatesJobData;
          const startDate = new Date(data.startDate);
          const endDate = new Date(data.endDate);

          // Pre-compute aggregates in background
          await CalendarAggregation.getOrComputeAggregates({
            userId: data.userId,
            workspaceId: data.workspaceId,
            startDate,
            endDate,
          });

          console.log(`[CalendarWorker] Pre-computed aggregates for user ${data.userId}`);
          break;
        }

        case "compute-insights": {
          const data = job.data as ComputeInsightsJobData;
          const startDate = new Date(data.startDate);
          const endDate = new Date(data.endDate);

          // Pre-compute insights in background
          await CalendarInsightsService.getInsights(
            data.userId,
            data.workspaceId,
            startDate,
            endDate,
          );

          console.log(`[CalendarWorker] Pre-computed insights for user ${data.userId}`);
          break;
        }

        case "pre-compute-user-calendar": {
          const data = job.data as PreComputeUserCalendarJobData;

          // Compute for current week and next week
          const now = new Date();
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay());
          startOfWeek.setHours(0, 0, 0, 0);

          const endOfNextWeek = new Date(startOfWeek);
          endOfNextWeek.setDate(startOfWeek.getDate() + 14);
          endOfNextWeek.setHours(23, 59, 59, 999);

          // Pre-compute aggregates
          await CalendarAggregation.getOrComputeAggregates({
            userId: data.userId,
            workspaceId: data.workspaceId,
            startDate: startOfWeek,
            endDate: endOfNextWeek,
          });

          // Pre-compute insights
          await CalendarInsightsService.getInsights(
            data.userId,
            data.workspaceId,
            startOfWeek,
            endOfNextWeek,
          );

          console.log(`[CalendarWorker] Pre-computed calendar for user ${data.userId}`);
          break;
        }

        default:
          throw new Error(`Unknown calendar job name: ${job.name}`);
      }

      console.log(`[CalendarWorker] Completed ${job.name} job ${job.id}`);
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      concurrency: 3,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[CalendarWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[CalendarWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
