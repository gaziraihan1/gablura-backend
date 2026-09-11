/**
 * Re-exports of the domain queue aliases. All of them point at the single
 * unified BullMQ queue ("jobs") — see jobs.queue.ts for the rationale.
 */
export { jobsQueue } from "./jobs.queue.js";
export { emailQueue } from "./email.queue.js";
export { notificationQueue } from "./notification.queue.js";
export { activityQueue } from "./activity.queue.js";
export { calendarQueue } from "./calendar.queue.js";
export { analyticsQueue } from "./analytics.queue.js";
export { integrationQueue } from "./integration.queue.js";
export { automationQueue } from "./automation.queue.js";
export { billingWebhookQueue } from "./billing-webhook.queue.js";