import type { NotificationType } from "@prisma/client";
import { NotificationPayload, SSEPayload, userChannel } from "../../lib/sse/sse.channels.js";
import { getPublisher } from "../../lib/redis/redis.pubsub.js";
import { prisma } from "../../lib/prisma.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const SSE_RETRY_ATTEMPTS = 3;
const SSE_RETRY_DELAY_MS = 100;

// ─── Delivery metrics ────────────────────────────────────────────────────────

interface PublishMetrics {
  totalAttempts: number;
  successfulPublishes: number;
  failedPublishes: number;
  lastFailure?: { timestamp: number; error: string; userId: string };
}

const metrics: PublishMetrics = {
  totalAttempts: 0,
  successfulPublishes: 0,
  failedPublishes: 0,
};

// ─── Internal publish helper with retry ──────────────────────────────────────

async function publishToSSE(
  userId: string,
  notification: NotificationPayload,
  retryCount: number = 0,
): Promise<boolean> {
  const payload: SSEPayload = {
    type: "notification",
    data: notification,
  };

  metrics.totalAttempts++;

  try {
    await getPublisher().publish(userChannel(userId), JSON.stringify(payload));
    metrics.successfulPublishes++;
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // Retry logic
    if (retryCount < SSE_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, SSE_RETRY_DELAY_MS * (retryCount + 1)));
      return publishToSSE(userId, notification, retryCount + 1);
    }

    // All retries failed
    metrics.failedPublishes++;
    metrics.lastFailure = {
      timestamp: Date.now(),
      error,
      userId,
    };

    console.error(
      `[notifyUser] Redis PUBLISH failed for user ${userId} after ${SSE_RETRY_ATTEMPTS} attempts:`,
      error,
    );

    // Log to Redis for monitoring (best effort)
    try {
      const redis = getPublisher();
      const logKey = `sse:publish:failed:${userId}:${Date.now()}`;
      await redis.setex(
        logKey,
        3600, // 1 hour TTL
        JSON.stringify({
          userId,
          notificationId: notification.id,
          error,
          timestamp: Date.now(),
        }),
      );
    } catch {
      // Redis unavailable - skip logging
    }

    return false;
  }
}

// ─── Shared options type ──────────────────────────────────────────────────────

interface NotifyUserOptions {
  userId: string;
  senderId?: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}

// ─── Core: write one notification and push it ────────────────────────────────

export async function notifyUser(opts: NotifyUserOptions): Promise<void> {
  const { userId, senderId, type, title, message, actionUrl } = opts;

  const notification = await prisma.notification.create({
    data: {
      userId,
      senderId: senderId ?? null,
      type,
      title,
      message,
      actionUrl: actionUrl ?? null,
    },
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      actionUrl: true,
      createdAt: true,
      read: true,
      sender: {
        select: { id: true, name: true, image: true },
      },
    },
  });

  // Try to push via SSE - failure is non-critical (notification is persisted)
  await publishToSSE(userId, {
    ...notification,
    type: notification.type as string,
    createdAt: notification.createdAt.toISOString(),
  });
}

// ─── Batch: write N notifications in one INSERT + parallel SSE publishes ─────
//
// Always prefer this over Promise.all(targets.map(notifyUser)) — reduces
// N DB round-trips to 1, regardless of recipient count.

export async function notifyUsers(
  notifications: NotifyUserOptions[],
): Promise<void> {
  if (notifications.length === 0) return;

  // 1. Single bulk INSERT — one round-trip for all recipients
  const created = await prisma.notification.createManyAndReturn({
    data: notifications.map(({ userId, senderId, type, title, message, actionUrl }) => ({
      userId,
      senderId:  senderId ?? null,
      type,
      title,
      message,
      actionUrl: actionUrl ?? null,
    })),
    select: {
      id:        true,
      userId:    true,
      type:      true,
      title:     true,
      message:   true,
      actionUrl: true,
      createdAt: true,
      read:      true,
    },
  });

  // 2. Fan out to Redis in parallel — a single publish failure never blocks others
  await Promise.allSettled(
    created.map((n) =>
      publishToSSE(n.userId, {
        id:        n.id,
        type:      n.type as string,
        title:     n.title,
        message:   n.message,
        actionUrl: n.actionUrl,
        createdAt: n.createdAt.toISOString(),
        read:      n.read,
        sender:    null,
      }),
    ),
  );
}

// ─── Notify all assignees of a task ──────────────────────────────────────────

interface NotifyTaskAssigneesOptions {
  taskId: string;
  senderId: string;
  type: NotificationType;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export async function notifyTaskAssignees(
  opts: NotifyTaskAssigneesOptions,
): Promise<void> {
  const { taskId, senderId, type, title, message, excludeUserId, actionUrl } = opts;

  const assignees = await prisma.taskAssignee.findMany({
    where:  { taskId },
    select: { userId: true },
  });

  const targets = assignees
    .map((a) => a.userId)
    .filter((id) => id !== excludeUserId);

  await notifyUsers(
    targets.map((userId) => ({ userId, senderId, type, title, message, actionUrl })),
  );
}

// ─── Notify all members of a workspace ───────────────────────────────────────

interface NotifyWorkspaceMembersOptions {
  workspaceId: string;
  workspaceSlug?: string; // Optional, only used for activity log metadata
  senderId: string;
  type: NotificationType;
  title: string;
  message: string;
  excludeUserId?: string;
  actionUrl?: string;
}

export async function notifyWorkspaceMembers(
  opts: NotifyWorkspaceMembersOptions,
): Promise<void> {
  const { workspaceId, senderId, type, title, message, excludeUserId, actionUrl } = opts;

  const members = await prisma.workspaceMember.findMany({
    where:  { workspaceId },
    select: { userId: true },
  });

  const targets = members
    .map((m) => m.userId)
    .filter((id) => id !== excludeUserId);

  await notifyUsers(
    targets.map((userId) => ({ userId, senderId, type, title, message, actionUrl })),
  );
}

// ─── Notify @mentioned users in a text string ────────────────────────────────

interface NotifyMentionsOptions {
  text: string;
  workspaceId: string;
  senderId: string;
  senderName: string;
  context: string;
  actionUrl?: string;
}

export async function notifyMentions(
  opts: NotifyMentionsOptions,
): Promise<void> {
  const { text, workspaceId, senderId, senderName, context, actionUrl } = opts;

  const handles = [...text.matchAll(/@([\w.]+)/g)].map((m) => m[1]);
  if (handles.length === 0) return;

  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      user: { name: { in: handles, mode: "insensitive" } },
    },
    select: { userId: true },
  });

  const uniqueTargets = [
    ...new Set(members.map((m) => m.userId).filter((id) => id !== senderId)),
  ];

  await notifyUsers(
    uniqueTargets.map((userId) => ({
      userId,
      senderId,
      type:      "MENTION" as NotificationType,
      title:     `${senderName} mentioned you`,
      message:   `You were mentioned in a ${context}`,
      actionUrl,
    })),
  );
}

// ─── Metrics export ──────────────────────────────────────────────────────────

export function getPublishMetrics(): PublishMetrics {
  return { ...metrics };
}

export function resetPublishMetrics(): void {
  metrics.totalAttempts = 0;
  metrics.successfulPublishes = 0;
  metrics.failedPublishes = 0;
  metrics.lastFailure = undefined;
}
