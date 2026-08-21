/**
 * src/modules/notification/notification.cron.ts
 *
 * Task reminders + notification cleanup crons.
 * Uses BullMQ for reliable notification delivery with retry/backoff.
 *
 * Reminder schedule:
 *   - TASK_DUE_SOON: 6h, 3h, 30m before due date
 *   - TASK_OVERDUE:  1h, 6h, 24h after due date
 *
 * Recipients: Task creator + all assignees (excluding creator if already assigned)
 *
 * Dedup: Each (taskId, userId, type, label) combo is tracked in Redis
 * with a 25-hour TTL to prevent duplicate notifications.
 */

import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { NotificationMutation } from "./notification.mutation.js";
import {
  processPendingNotifications,
  DEDUP_PREFIX,
  type PendingNotification,
} from "./cron.utils.js";
import {
  startProjectReminderCron,
  startProjectAutoArchiveCron,
} from "./project.cron.js";
import { startMeetingReminderCron } from "./meeting.cron.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

/** Due-soon reminder windows (milliseconds before due date) */
const REMINDERS = [
  { label: "6h",  ms: 6  * 60 * 60 * 1000 },
  { label: "3h",  ms: 3  * 60 * 60 * 1000 },
  { label: "30m", ms: 30 * 60 * 1000 },
] as const;

/** Overdue notification windows (milliseconds after due date) */
const OVERDUE_MARKS = [
  { label: "1h",  ms: 1  * 60 * 60 * 1000 },
  { label: "6h",  ms: 6  * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
] as const;

/** Tolerance window for cron interval alignment (5 min) */
const WINDOW_MS = 5 * 60 * 1000;

// ─── DB cursor pagination ─────────────────────────────────────────────────────

async function fetchTaskPage(cursor?: string) {
  return prisma.task.findMany({
    where: {
      dueDate: { not: null },
      status:  { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: {
      id:          true,
      title:       true,
      dueDate:     true,
      createdById: true,
      // Include the creator's notification preference directly so we
      // never need a separate user lookup per task (N+1 elimination).
      createdBy: {
        select: { notifications: true },
      },
      assignees: {
        select: {
          userId: true,
          user:   { select: { notifications: true } },
        },
      },
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}

// ─── Build recipient list (creator + assignees) ───────────────────────────────

/**
 * Returns a deduplicated list of user IDs who should receive
 * due-date notifications for this task, along with their
 * notification preference status.
 *
 * NOTE: Now fully synchronous — the creator's notification preference
 * is included in the task query (createdBy), so no extra DB call is needed.
 * Previously this made a prisma.user.findMany per task (N+1).
 */
function getRecipients(
  createdById: string,
  createdByNotifs: boolean,
  assignees: { userId: string; user: { notifications: boolean } }[],
): { userId: string; notifications: boolean }[] {
  const seen = new Set<string>();
  const recipients: { userId: string; notifications: boolean }[] = [];

  // Add creator (notification pref from the task query, no extra DB call)
  recipients.push({ userId: createdById, notifications: createdByNotifs });
  seen.add(createdById);

  // Add assignees (deduplicated)
  for (const a of assignees) {
    if (!seen.has(a.userId)) {
      seen.add(a.userId);
      recipients.push({ userId: a.userId, notifications: a.user.notifications });
    }
  }

  return recipients;
}

// ─── Build pending notifications for one task ─────────────────────────────────

function buildPendingNotifs(
  task: { id: string; title: string; dueDate: Date | null },
  recipients: { userId: string; notifications: boolean }[],
  now: number,
): PendingNotification[] {
  const due = new Date(task.dueDate!).getTime();
  const pending: PendingNotification[] = [];

  // Due-soon reminders
  for (const r of REMINDERS) {
    const timeUntilDue = due - now;
    if (timeUntilDue >= r.ms - WINDOW_MS && timeUntilDue < r.ms) {
      for (const recipient of recipients) {
        if (!recipient.notifications) continue;
        pending.push({
          dedupKey:  `${DEDUP_PREFIX}${task.id}:${recipient.userId}:DUE_SOON:${r.label}`,
          userId:    recipient.userId,
          type:      "TASK_DUE_SOON",
          title:     "Task Due Soon",
          message:   `"${task.title}" is due in ${r.label}`,
          actionUrl: `/dashboard/tasks/${task.id}`,
        });
      }
    }
  }

  // Overdue notifications
  for (const o of OVERDUE_MARKS) {
    const timeOverdue = now - due;
    if (timeOverdue >= o.ms && timeOverdue < o.ms + WINDOW_MS) {
      for (const recipient of recipients) {
        if (!recipient.notifications) continue;
        pending.push({
          dedupKey:  `${DEDUP_PREFIX}${task.id}:${recipient.userId}:OVERDUE:${o.label}`,
          userId:    recipient.userId,
          type:      "TASK_OVERDUE",
          title:     "Task Overdue",
          message:   `"${task.title}" is overdue by ${o.label}`,
          actionUrl: `/dashboard/tasks/${task.id}`,
        });
      }
    }
  }

  return pending;
}

// ─── Main cron logic ──────────────────────────────────────────────────────────

async function runTaskReminderCron(): Promise<void> {
  const now = Date.now();
  let total = 0;
  let sent = 0;
  let cursor: string | undefined;

  while (true) {
    const tasks = await fetchTaskPage(cursor);
    if (tasks.length === 0) break;

    total += tasks.length;

    const pending: PendingNotification[] = [];
    for (const task of tasks) {
      // Recipients = task creator + all assignees (deduplicated by
      // getRecipients). We deliberately do NOT skip tasks without assignees:
      // a creator-only task still needs its due-soon/overdue reminders, and
      // getRecipients always includes the creator.
      const recipients = getRecipients(
        task.createdById,
        task.createdBy.notifications,
        task.assignees,
      );
      pending.push(...buildPendingNotifs(task, recipients, now));
    }

    sent += await processPendingNotifications(pending);

    if (tasks.length < BATCH_SIZE) break;
    cursor = tasks[tasks.length - 1].id;
  }

  console.log(
    `✅ Task reminder cron done — ${total} tasks scanned, ${sent} notifications queued via BullMQ`,
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function startTaskReminderCron(): void {
  cron.schedule("*/15 * * * *", async () => {
    try {
      await runTaskReminderCron();
    } catch (error) {
      console.error("❌ Task reminder cron failed:", error);
    }
  });
  console.log("✅ Task reminder cron started (every 15 min, BullMQ-backed)");
}

export function startNotificationCleanupCron(): void {
  cron.schedule("0 3 * * *", async () => {
    try {
      console.log("🧹 Running notification cleanup…");
      const { count } = await NotificationMutation.deleteOldReadNotifications(30);
      console.log(`  ✅ Deleted ${count} old read notifications`);
    } catch (error) {
      console.error("❌ Notification cleanup cron failed:", error);
    }
  });
  console.log("✅ Notification cleanup cron started (daily at 3 AM)");
}

export function initNotificationCrons(): void {
  startTaskReminderCron();
  startNotificationCleanupCron();
  startProjectReminderCron();
  startProjectAutoArchiveCron();
  startMeetingReminderCron();
}
