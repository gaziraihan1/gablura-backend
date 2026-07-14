import { emailQueue } from "./queues/email.queue.js";
import { notificationQueue } from "./queues/notification.queue.js";
import { activityQueue } from "./queues/activity.queue.js";
import { calendarQueue } from "./queues/calendar.queue.js";
import { analyticsQueue } from "./queues/analytics.queue.js";

import { createEmailWorker } from "./workers/email.worker.js";
import { createNotificationWorker } from "./workers/notification.worker.js";
import { createActivityWorker } from "./workers/activity.worker.js";
import { createCalendarWorker } from "./workers/calendar.worker.js";
import { createAnalyticsWorker } from "./workers/analytics.worker.js";

import type { Worker } from "bullmq";

let workers: Worker[] = [];

export async function initQueueWorkers() {
  console.log("[Queue] Initializing queue workers...");

  const emailWorker = createEmailWorker();
  const notificationWorker = createNotificationWorker();
  const activityWorker = createActivityWorker();
  const calendarWorker = createCalendarWorker();
  const analyticsWorker = createAnalyticsWorker();

  workers = [emailWorker, notificationWorker, activityWorker, calendarWorker, analyticsWorker];

  console.log("[Queue] All queue workers started");
}

export async function closeQueueWorkers() {
  console.log("[Queue] Closing queue workers...");

  await Promise.all(
    workers.map((worker) => worker.close())
  );

  await Promise.all([
    emailQueue.close(),
    notificationQueue.close(),
    activityQueue.close(),
    calendarQueue.close(),
    analyticsQueue.close(),
  ]);

  console.log("[Queue] All queue workers closed");
}

export {
  emailQueue,
  notificationQueue,
  activityQueue,
  calendarQueue,
  analyticsQueue,
};

export {
  addSendEmailJob,
} from "./queues/email.queue.js";

export {
  addSendNotificationJob,
  addNotifyTaskAssigneesJob,
  addNotifyWorkspaceMembersJob,
} from "./queues/notification.queue.js";

export {
  addLogActivityJob,
  addInvalidateCacheJob,
  addUpdateStorageQuotaJob,
} from "./queues/activity.queue.js";

export {
  addComputeAggregatesJob,
  addComputeInsightsJob,
  addPreComputeUserCalendarJob,
} from "./queues/calendar.queue.js";

export {
  addPreComputeAnalyticsJob,
  addComputeFocusStreakJob,
} from "./queues/analytics.queue.js";
