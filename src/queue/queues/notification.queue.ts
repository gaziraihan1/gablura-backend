import { jobsQueue } from "./jobs.queue.js";

// Legacy alias — retained so existing imports/tests keep working.
export const notificationQueue = jobsQueue;

// Job data types
export interface SendNotificationJobData {
  userId: string;
  senderId?: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
}

export interface NotifyTaskAssigneesJobData {
  taskId: string;
  senderId: string;
  type: string;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export interface NotifyWorkspaceMembersJobData {
  workspaceId: string;
  senderId: string;
  type: string;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export async function addSendNotificationJob(jobData: SendNotificationJobData) {
  return jobsQueue.add("send-notification", jobData, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function addNotifyTaskAssigneesJob(jobData: NotifyTaskAssigneesJobData) {
  return jobsQueue.add("notify-task-assignees", jobData, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function addNotifyWorkspaceMembersJob(jobData: NotifyWorkspaceMembersJobData) {
  return jobsQueue.add("notify-workspace-members", jobData, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}
