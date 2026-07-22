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
import { addSendNotificationJob } from "../../queue/queues/notification.queue.js";
import { getRedisClient } from "../../redis/redis.client.js";

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

/** Redis key prefix for dedup */
const DEDUP_PREFIX = "notif:cron:sent:";
const DEDUP_TTL_S = 25 * 60 * 60; // 25 hours

// ─── Redis dedup via pipeline ─────────────────────────────────────────────────

/**
 * Batch-check dedup keys using a single Redis pipeline.
 * Returns a Set of keys that were already sent.
 */
async function batchWasAlreadySent(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  const redis = getRedisClient();
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.get(key);
  }
  const results = await pipeline.exec();

  const sent = new Set<string>();
  if (!results) return sent;

  for (let i = 0; i < results.length; i++) {
    const [err, val] = results[i];
    if (!err && val) {
      sent.add(keys[i]);
    }
  }
  return sent;
}

/**
 * Mark dedup keys as sent using a single Redis pipeline.
 */
async function batchMarkAsSent(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getRedisClient();
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.setex(key, DEDUP_TTL_S, "1");
  }
  await pipeline.exec();
}

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
 */
async function getRecipients(
  createdById: string,
  assignees: { userId: string; user: { notifications: boolean } }[],
): Promise<{ userId: string; notifications: boolean }[]> {
  // Collect all unique user IDs (creator + assignees)
  const userIds = new Set<string>([createdById]);
  for (const a of assignees) {
    userIds.add(a.userId);
  }

  // Build a map of assignee notification preferences
  const assigneeMap = new Map<string, boolean>();
  for (const a of assignees) {
    assigneeMap.set(a.userId, a.user.notifications);
  }

  // For the creator, we need to look up their preference
  // (it's not in the assignees query)
  const uniqueIds = Array.from(userIds);
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, notifications: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u.notifications]));

  return uniqueIds.map((userId) => ({
    userId,
    notifications: userMap.get(userId) ?? true,
  }));
}

// ─── Build pending notifications for one task ─────────────────────────────────

interface PendingNotif {
  dedupKey:  string;
  userId:    string;
  type:      "TASK_DUE_SOON" | "TASK_OVERDUE";
  title:     string;
  message:   string;
  actionUrl: string;
}

function buildPendingNotifs(
  task: { id: string; title: string; dueDate: Date | null },
  recipients: { userId: string; notifications: boolean }[],
  now: number,
): PendingNotif[] {
  const due = new Date(task.dueDate!).getTime();
  const pending: PendingNotif[] = [];

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

// ─── Dispatch pending notifications via BullMQ ───────────────────────────────

async function processPendingNotifs(pending: PendingNotif[]): Promise<number> {
  if (pending.length === 0) return 0;

  // Batch dedup check via single Redis pipeline
  const dedupKeys = pending.map((n) => n.dedupKey);
  const alreadySent = await batchWasAlreadySent(dedupKeys);
  const toSend = pending.filter((n) => !alreadySent.has(n.dedupKey));
  if (toSend.length === 0) return 0;

  // Dispatch through BullMQ for reliable delivery with retry
  const results = await Promise.allSettled(
    toSend.map((n) =>
      addSendNotificationJob({
        userId:    n.userId,
        type:      n.type,
        title:     n.title,
        message:   n.message,
        actionUrl: n.actionUrl,
      }),
    ),
  );

  // Batch mark successfully queued jobs as sent via single Redis pipeline
  const succeededKeys: string[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      succeededKeys.push(toSend[i].dedupKey);
    }
  }
  await batchMarkAsSent(succeededKeys);

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    failed.forEach((r) => {
      if (r.status === "rejected") {
        console.error("  ⚠️  BullMQ notification job failed:", r.reason);
      }
    });
  }

  return succeededKeys.length;
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

    const pending: PendingNotif[] = [];
    for (const task of tasks) {
      if (!task.assignees.length) continue;

      // Get all recipients (creator + assignees, deduplicated)
      const recipients = await getRecipients(task.createdById, task.assignees);
      pending.push(...buildPendingNotifs(task, recipients, now));
    }

    sent += await processPendingNotifs(pending);

    if (tasks.length < BATCH_SIZE) break;
    cursor = tasks[tasks.length - 1].id;
  }

  console.log(
    `✅ Task reminder cron done — ${total} tasks scanned, ${sent} notifications queued via BullMQ`,
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function startTaskReminderCron(): void {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await runTaskReminderCron();
    } catch (error) {
      console.error("❌ Task reminder cron failed:", error);
    }
  });
  console.log("✅ Task reminder cron started (every 5 min, BullMQ-backed)");
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
}
