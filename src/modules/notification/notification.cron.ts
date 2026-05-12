/**
 * src/crons/notification.cron.ts
 *
 * Task reminders + notification cleanup crons.
 *
 * The only change from the original: notifyUser is now imported from
 * ../../utils/notification.helpers (where it has always lived architecturally)
 * rather than ./notification.helpers (which no longer exports it).
 *
 * Everything else — batch cursor logic, Redis dedup, cron schedules —
 * is identical to the previous version.
 */

import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { notifyUser } from "./notification.helpers.js";
import { NotificationMutation } from "./notification.mutation.js";
import { getRedisClient } from "../../redis/redis.client.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

const REMINDERS = [
  { label: "6h",  ms: 6  * 60 * 60 * 1000 },
  { label: "3h",  ms: 3  * 60 * 60 * 1000 },
  { label: "30m", ms: 30 * 60 * 1000 },
] as const;

const OVERDUE_MARKS = [
  { label: "1h",  ms: 1  * 60 * 60 * 1000 },
  { label: "6h",  ms: 6  * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
] as const;

const WINDOW_MS   = 5 * 60 * 1000;
const NOTIF_TTL_S = 25 * 60 * 60;

// ─── Redis dedup ──────────────────────────────────────────────────────────────

function notifKey(
  taskId: string,
  userId: string,
  type: string,
  label: string,
): string {
  return `notif:sent:${taskId}:${userId}:${type}:${label}`;
}

async function wasSent(key: string): Promise<boolean> {
  const val = await getRedisClient().get(key);
  return !!val;
}

async function markSent(key: string): Promise<void> {
  await getRedisClient().setex(key, NOTIF_TTL_S, "1"); // ioredis: setex(key, ttl, value)
}

// ─── DB cursor pagination ─────────────────────────────────────────────────────

async function fetchTaskPage(cursor?: string) {
  return prisma.task.findMany({
    where: {
      dueDate: { not: null },
      status:  { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: {
      id:    true,
      title: true,
      dueDate: true,
      assignees: {
        select: {
          userId: true,
          user: { select: { notifications: true } },
        },
      },
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}

// ─── Build pending notifications for one task ─────────────────────────────────

interface PendingNotif {
  key:       string;
  userId:    string;
  type:      "TASK_DUE_SOON" | "TASK_OVERDUE";
  title:     string;
  message:   string;
  actionUrl: string;
}

function buildPendingNotifs(
  task: { id: string; title: string; dueDate: Date | null },
  assignees: { userId: string; user: { notifications: boolean } }[],
  now: number,
): PendingNotif[] {
  const due = new Date(task.dueDate!).getTime();
  const pending: PendingNotif[] = [];

  for (const r of REMINDERS) {
    const timeUntilDue = due - now;
    if (timeUntilDue >= r.ms - WINDOW_MS && timeUntilDue < r.ms) {
      for (const a of assignees) {
        if (!a.user.notifications) continue;
        pending.push({
          key:       notifKey(task.id, a.userId, "DUE_SOON", r.label),
          userId:    a.userId,
          type:      "TASK_DUE_SOON",
          title:     "Task Due Soon",
          message:   `"${task.title}" is due in ${r.label}`,
          actionUrl: `/dashboard/tasks/${task.id}`,
        });
      }
    }
  }

  for (const o of OVERDUE_MARKS) {
    const timeOverdue = now - due;
    if (timeOverdue >= o.ms && timeOverdue < o.ms + WINDOW_MS) {
      for (const a of assignees) {
        if (!a.user.notifications) continue;
        pending.push({
          key:       notifKey(task.id, a.userId, "OVERDUE", o.label),
          userId:    a.userId,
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

// ─── Dispatch pending notifications ──────────────────────────────────────────

async function processPendingNotifs(pending: PendingNotif[]): Promise<number> {
  if (pending.length === 0) return 0;

  const sentFlags = await Promise.all(pending.map((n) => wasSent(n.key)));
  const toSend = pending.filter((_, i) => !sentFlags[i]);
  if (toSend.length === 0) return 0;

  const results = await Promise.allSettled(
    toSend.map(async (n) => {
      await notifyUser({
        userId:    n.userId,
        type:      n.type,
        title:     n.title,
        message:   n.message,
        actionUrl: n.actionUrl,
      });
      await markSent(n.key);
    }),
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    failed.forEach((r) => {
      if (r.status === "rejected") {
        console.error("  ⚠️  Notification failed:", r.reason);
      }
    });
  }

  return toSend.length - failed.length;
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
      pending.push(...buildPendingNotifs(task, task.assignees, now));
    }

    sent += await processPendingNotifs(pending);

    if (tasks.length < BATCH_SIZE) break;
    cursor = tasks[tasks.length - 1].id;
  }

  console.log(
    `✅ Task reminder cron done — ${total} tasks scanned, ${sent} notifications sent`,
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
  console.log("✅ Task reminder cron started (every 5 min)");
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