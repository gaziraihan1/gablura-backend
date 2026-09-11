import { Job } from "bullmq";

import { AttachmentRepository } from "../../modules/attachment/attachment.repository.js";
import { AnalyticsCache, WorkspaceCache, TaskCache, CalendarCache, AccessControlCache, ActivityCache } from "../../lib/redis/cache.client.js";
import { incrementWorkspaceStorage, decrementWorkspaceStorage } from "../../modules/attachment/attatchment.quota.service.js";
import type { LogActivityJobData, InvalidateCacheJobData, UpdateStorageQuotaJobData } from "../queues/activity.queue.js";

/**
 * Processor for activity/cache-invalidation jobs. Previously owned by a
 * dedicated Worker instance; now invoked by the consolidated jobs worker
 * (src/queue/workers/jobs.worker.ts).
 */
export async function processActivityJob(
  job: Job<LogActivityJobData | InvalidateCacheJobData | UpdateStorageQuotaJobData>,
): Promise<void> {
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

        case "invalidate-cache-batch": {
          const { jobs } = job.data as unknown as { jobs: InvalidateCacheJobData[] };
          const promises: Promise<void>[] = [];
          for (const data of jobs) {
            switch (data.type) {
              case "analytics":
                if (data.workspaceId) promises.push(AnalyticsCache.invalidateWorkspace(data.workspaceId));
                break;
              case "workspace":
                if (data.workspaceId) promises.push(WorkspaceCache.invalidateWorkspace(data.workspaceId));
                break;
              case "task":
                if (data.taskId) promises.push(TaskCache.invalidateTask(data.taskId));
                if (data.userId && data.workspaceId) promises.push(TaskCache.invalidateTaskStats(data.userId, data.workspaceId));
                else if (data.userId) promises.push(TaskCache.invalidateTaskStats(data.userId));
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
                if (data.taskId) promises.push(AccessControlCache.invalidateTaskUsers(data.taskId));
                if (data.workspaceId) promises.push(AccessControlCache.invalidateWorkspaceUsers(data.workspaceId));
                break;
              case "activity":
                if (data.workspaceId) promises.push(ActivityCache.invalidateWorkspaceActivities(data.workspaceId));
                if (data.userId) promises.push(ActivityCache.invalidateUserActivities(data.userId, data.workspaceId));
                if (data.taskId) promises.push(ActivityCache.invalidateTaskActivities(data.taskId));
                break;
            }
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
}
