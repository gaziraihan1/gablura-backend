/**
 * src/modules/notification/cron.utils.ts
 *
 * Shared utilities for notification cron jobs.
 * Redis dedup helpers, batch processing, and common constants.
 */

import { getRedisClient } from "../../redis/redis.client.js";
import { addSendNotificationJob } from "../../queue/queues/notification.queue.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis key prefix for dedup */
export const DEDUP_PREFIX = "notif:cron:sent:";
export const DEDUP_TTL_S = 25 * 60 * 60; // 25 hours

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingNotification {
  dedupKey: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  actionUrl: string;
}

// ─── Redis dedup via pipeline ─────────────────────────────────────────────────

/**
 * Batch-check dedup keys using a single Redis pipeline.
 * Returns a Set of keys that were already sent.
 */
export async function batchWasAlreadySent(keys: string[]): Promise<Set<string>> {
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
export async function batchMarkAsSent(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getRedisClient();
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.setex(key, DEDUP_TTL_S, "1");
  }
  await pipeline.exec();
}

// ─── Process pending notifications ────────────────────────────────────────────

/**
 * Process pending notifications with dedup and BullMQ dispatch.
 * Returns the number of notifications successfully queued.
 */
export async function processPendingNotifications(
  pending: PendingNotification[],
): Promise<number> {
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
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
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
