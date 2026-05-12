/**
 * src/utils/notification.helpers.ts
 *
 * All notification dispatch functions.
 * The only change from the previous version: instead of looking up an in-memory
 * Map of SSE connections and writing directly to Response objects, we:
 *   1. Write the Notification row to Postgres (unchanged).
 *   2. PUBLISH the payload to the user's Redis channel.
 *      → The SSE handler (notification.stream.ts) receives it on every process
 *        that has an open connection for that user and fans it out to the browser.
 *
 * This makes the notification pipeline stateless with respect to which backend
 * instance the user is connected to.
 */

import type { NotificationType } from "@prisma/client";
import { NotificationPayload, SSEPayload, userChannel } from "../../lib/sse/sse.channels.js";
import { getPublisher } from "../../lib/redis/redis.pubsub.js";
import { prisma } from "../../lib/prisma.js";

// ─── Internal publish helper ─────────────────────────────────────────────────

async function publishToSSE(
  userId: string,
  notification: NotificationPayload,
): Promise<void> {
  const payload: SSEPayload = {
    type: "notification",
    data: notification,
  };

  try {
    await getPublisher().publish(userChannel(userId), JSON.stringify(payload));
  } catch (err) {
    // Never let a Redis error break the API response — the DB write succeeded,
    // so the notification is durable. The client will see it on next poll/reconnect.
    console.error("[notifyUser] Redis PUBLISH failed for user", userId, err);
  }
}

// ─── Core: write one notification and push it ────────────────────────────────

interface NotifyUserOptions {
  userId: string;
  senderId?: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}

export async function notifyUser(opts: NotifyUserOptions): Promise<void> {
  const { userId, senderId, type, title, message, actionUrl } = opts;
    console.log("[notifyUser] called for", opts.userId, opts.type); // add this


  // 1. Persist to DB
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

  // 2. Push via Redis pub/sub → SSE
  await publishToSSE(userId, {
    ...notification,
    type: notification.type as string,
    createdAt: notification.createdAt.toISOString(),
  });
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
    where: { taskId },
    select: { userId: true },
  });

  const targets = assignees
    .map((a) => a.userId)
    .filter((id) => id !== excludeUserId);

  await Promise.all(
    targets.map((userId) =>
      notifyUser({ userId, senderId, type, title, message, actionUrl }),
    ),
  );
}

// ─── Notify all members of a workspace ───────────────────────────────────────

interface NotifyWorkspaceMembersOptions {
  workspaceId: string;
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
  const { workspaceId, senderId, type, title, message, excludeUserId, actionUrl } =
    opts;

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  });

  const targets = members
    .map((m) => m.userId)
    .filter((id) => id !== excludeUserId);

  await Promise.all(
    targets.map((userId) =>
      notifyUser({ userId, senderId, type, title, message, actionUrl }),
    ),
  );
}

// ─── Notify @mentioned users in a text string ────────────────────────────────

interface NotifyMentionsOptions {
  text: string;
  workspaceId: string;
  senderId: string;
  senderName: string;
  context: string;   // e.g. "comment", "task description"
  actionUrl?: string;
}

/**
 * Extracts @handle or @name patterns from `text`, resolves them to workspace
 * members, and sends notifications to each unique matched user.
 */
export async function notifyMentions(
  opts: NotifyMentionsOptions,
): Promise<void> {
  const { text, workspaceId, senderId, senderName, context, actionUrl } = opts;

  // Extract @word tokens (e.g. @john, @john.doe)
  const handles = [...text.matchAll(/@([\w.]+)/g)].map((m) => m[1]);
  if (handles.length === 0) return;

  // Resolve to workspace members whose name matches (case-insensitive prefix)
  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      user: {
        name: { in: handles, mode: "insensitive" },
      },
    },
    select: { userId: true },
  });

  const uniqueTargets = [
    ...new Set(members.map((m) => m.userId).filter((id) => id !== senderId)),
  ];

  await Promise.all(
    uniqueTargets.map((userId) =>
      notifyUser({
        userId,
        senderId,
        type: "MENTION",
        title: `${senderName} mentioned you`,
        message: `You were mentioned in a ${context}`,
        actionUrl,
      }),
    ),
  );
}