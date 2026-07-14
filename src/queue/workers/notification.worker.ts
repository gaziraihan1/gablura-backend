import { Worker, Job } from "bullmq";
import { notifyUser, notifyUsers, notifyTaskAssignees, notifyWorkspaceMembers } from "../../modules/notification/notification.helpers.js";
import type { SendNotificationJobData, NotifyTaskAssigneesJobData, NotifyWorkspaceMembersJobData } from "../queues/notification.queue.js";

const NOTIFICATION_WORKER_NAME = "notification-worker";

export function createNotificationWorker() {
  const worker = new Worker(
    NOTIFICATION_WORKER_NAME,
    async (job: Job<SendNotificationJobData | NotifyTaskAssigneesJobData | NotifyWorkspaceMembersJobData>) => {
      console.log(`[NotificationWorker] Processing ${job.name} job ${job.id}`);

      switch (job.name) {
        case "send-notification": {
          const data = job.data as SendNotificationJobData;
          await notifyUser({
            userId: data.userId,
            senderId: data.senderId,
            type: data.type as any,
            title: data.title,
            message: data.message,
            actionUrl: data.actionUrl,
          });
          break;
        }

        case "notify-task-assignees": {
          const data = job.data as NotifyTaskAssigneesJobData;
          await notifyTaskAssignees({
            taskId: data.taskId,
            senderId: data.senderId,
            type: data.type as any,
            title: data.title,
            message: data.message,
            excludeUserId: data.excludeUserId,
            actionUrl: data.actionUrl,
          });
          break;
        }

        case "notify-workspace-members": {
          const data = job.data as NotifyWorkspaceMembersJobData;
          await notifyWorkspaceMembers({
            workspaceId: data.workspaceId,
            senderId: data.senderId,
            type: data.type as any,
            title: data.title,
            message: data.message,
            excludeUserId: data.excludeUserId,
            actionUrl: data.actionUrl,
          });
          break;
        }

        default:
          throw new Error(`Unknown notification job name: ${job.name}`);
      }

      console.log(`[NotificationWorker] Completed ${job.name} job ${job.id}`);
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379"),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      },
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[NotificationWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[NotificationWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
