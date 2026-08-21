import { Worker, Job } from "bullmq";

import { AttachmentRepository } from "../../modules/attachment/attachment.repository.js";
import { AnalyticsCache, WorkspaceCache, TaskCache, CalendarCache, AccessControlCache, ActivityCache } from "../../lib/redis/cache.client.js";
import { incrementWorkspaceStorage, decrementWorkspaceStorage } from "../../modules/attachment/attatchment.quota.service.js";
import type { LogActivityJobData, InvalidateCacheJobData, UpdateStorageQuotaJobData } from "../queues/activity.queue.js";

const ACTIVITY_WORKER_NAME = "activity-worker";

export function createActivityWorker() {
  const worker = new Worker(
    ACTIVITY_WORKER_NAME,
    async (job: Job<LogActivityJobData | InvalidateCacheJobData | UpdateStorageQuotaJobData>) => {
      console.log(`[ActivityWorker] Processing ${job.name} job ${job.id}`);

      switch (job.name) {
        case "log-activity": {
          const data = job.data as LogActivityJobData;
          await AttachmentRepository.createActivity({
            action: data.action,
            entityType: data.entityType,
            entityId: data.entityId,
            userId: data.userId,
            workspaceId: data.workspaceId,
            workspaceSlug: data.workspaceSlug,
            taskId: data.taskId,
            metadata: data.metadata,
          });
          break;
        }

        case "invalidate-cache": {
          const data = job.data as InvalidateCacheJobData;
          const promises: Promise<void>[] = [];

          switch (data.type) {
            case "analytics":
              if (data.workspaceId) {
                promises.push(AnalyticsCache.invalidateWorkspace(data.workspaceId));
              }
              break;

            case "workspace":
              if (data.workspaceId) {
                promises.push(WorkspaceCache.invalidateWorkspace(data.workspaceId));
              }
              break;

            case "task":
              if (data.taskId) {
                promises.push(TaskCache.invalidateTask(data.taskId));
              }
              if (data.userId && data.workspaceId) {
                promises.push(TaskCache.invalidateTaskStats(data.userId, data.workspaceId));
              } else if (data.userId) {
                promises.push(TaskCache.invalidateTaskStats(data.userId));
              }
              break;

            case "calendar":
              if (data.userId && data.workspaceId) {
                promises.push(CalendarCache.invalidateAggregates(data.userId, data.workspaceId));
                promises.push(CalendarCache.invalidateInsights(data.userId, data.workspaceId));
              } else if (data.userId) {
                promises.push(CalendarCache.invalidateAggregates(data.userId));
                promises.push(CalendarCache.invalidateInsights(data.userId));
              }
              break;

            case "access-control":
              if (data.taskId) {
                promises.push(AccessControlCache.invalidateTaskUsers(data.taskId));
              }
              if (data.workspaceId) {
                promises.push(AccessControlCache.invalidateWorkspaceUsers(data.workspaceId));
              }
              break;

            case "activity":
              if (data.workspaceId) {
                promises.push(ActivityCache.invalidateWorkspaceActivities(data.workspaceId));
              }
              if (data.userId) {
                promises.push(ActivityCache.invalidateUserActivities(data.userId, data.workspaceId));
              }
              if (data.taskId) {
                promises.push(ActivityCache.invalidateTaskActivities(data.taskId));
              }
              break;
          }

          await Promise.allSettled(promises);
          break;
        }

        case "update-storage-quota": {
          const data = job.data as UpdateStorageQuotaJobData;
          if (data.operation === "increment") {
            await incrementWorkspaceStorage(data.workspaceId, data.bytes);
          } else {
            await decrementWorkspaceStorage(data.workspaceId, data.bytes);
          }
          break;
        }

        default:
          throw new Error(`Unknown activity job name: ${job.name}`);
      }

      console.log(`[ActivityWorker] Completed ${job.name} job ${job.id}`);
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
    }
  );

  worker.on("completed", (job) => {
    console.log(`[ActivityWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[ActivityWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
