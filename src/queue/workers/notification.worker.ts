import { Job } from "bullmq";
import { notifyUser, notifyTaskAssignees, notifyWorkspaceMembers } from "../../modules/notification/notification.helpers.js";
import type { SendNotificationJobData, NotifyTaskAssigneesJobData, NotifyWorkspaceMembersJobData } from "../queues/notification.queue.js";

/**
 * Processor for notification jobs. Previously owned by a dedicated Worker
 * instance; now invoked by the consolidated jobs worker.
 */
export async function processNotificationJob(
  job: Job<SendNotificationJobData | NotifyTaskAssigneesJobData | NotifyWorkspaceMembersJobData>,
): Promise<void> {
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
}
