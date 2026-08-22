/**
 * src/modules/notification/meeting.cron.ts
 *
 * Meeting reminder cron — the "meeting time is coming" notifications.
 *
 * Reminder schedule:
 *   - MEETING_REMINDER: 24h, 1h, 15m before start time
 *
 * Recipients:
 *   - PRIVATE meetings: the attendees (deduped) + the creator
 *   - PUBLIC meetings:  all workspace members
 *   (every recipient is filtered by their notification preference)
 *
 * Dedup: each (meetingId, userId, label) combo is tracked in Redis with a
 * 25-hour TTL (shared DEDUP_PREFIX from cron.utils) so the 5-minute cron
 * never double-sends.
 */

import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import {
  processPendingNotifications,
  DEDUP_PREFIX,
  type PendingNotification,
} from "./cron.utils.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Reminder windows (milliseconds before start time) */
const MEETING_REMINDERS = [
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "1h",  ms: 1  * 60 * 60 * 1000 },
  { label: "15m", ms: 15 * 60 * 1000 },
] as const;

/** Tolerance window for cron interval alignment (5 min) */
const WINDOW_MS = 5 * 60 * 1000;

/** Meetings further away than this are not scanned (24h + window) */
const MAX_AHEAD_MS = MEETING_REMINDERS[0].ms + WINDOW_MS;

const MEETING_DEDUP_PREFIX = `${DEDUP_PREFIX}meeting:`;

// ─── Recipient resolution ─────────────────────────────────────────────────────

/**
 * Resolve reminder recipients for a meeting.
 * Private → attendees (unique) + creator; Public → all workspace members.
 * Returns userIds whose notifications preference is enabled.
 */
/**
 * Synchronous recipient resolution for PRIVATE meetings.
 * Uses pre-fetched attendee+creator notification prefs (no DB calls).
 */
function getPrivateRecipients(
  attendees: { userId: string; user: { notifications: boolean } }[],
  createdBy: { notifications: boolean },
  createdById: string,
): string[] {
  const userIds = new Set<string>();
  for (const a of attendees) {
    if (a.user.notifications) userIds.add(a.userId);
  }
  if (createdBy.notifications) userIds.add(createdById);
  return Array.from(userIds);
}

/**
 * Synchronous recipient resolution for PUBLIC meetings.
 * Uses pre-fetched workspace member notification prefs (no DB calls).
 */
function getPublicRecipients(
  members: { userId: string; user: { notifications: boolean } }[],
): string[] {
  return members.filter((m) => m.user.notifications).map((m) => m.userId);
}

// ─── Build pending notifications ──────────────────────────────────────────────

function buildMeetingPendingNotifs(
  meeting: { id: string; title: string; startTime: Date; workspace?: { slug: string } | null },
  recipients: string[],
  now: number,
): PendingNotification[] {
  const pending: PendingNotification[] = [];
  const actionUrl = meeting.workspace
    ? `/dashboard/workspaces/${meeting.workspace.slug}/meetings/${meeting.id}`
    : `/dashboard/meetings/${meeting.id}`;

  for (const r of MEETING_REMINDERS) {
    const timeUntilStart = meeting.startTime.getTime() - now;
    if (timeUntilStart >= r.ms - WINDOW_MS && timeUntilStart < r.ms) {
      for (const userId of recipients) {
        pending.push({
          dedupKey: `${MEETING_DEDUP_PREFIX}${meeting.id}:${userId}:REMINDER:${r.label}`,
          userId,
          type: "MEETING_REMINDER",
          title: "Meeting Reminder",
          message: `"${meeting.title}" starts in ${r.label}`,
          actionUrl,
        });
      }
    }
  }

  return pending;
}

// ─── Main cron logic ──────────────────────────────────────────────────────────

async function runMeetingReminderCron(): Promise<void> {
  const now = Date.now();

  const meetings = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      startTime: {
        gt: new Date(now),
        lt: new Date(now + MAX_AHEAD_MS),
      },
    },
    select: {
      id: true,
      title: true,
      visibility: true,
      createdById: true,
      workspaceId: true,
      startTime: true,
      createdBy: { select: { notifications: true } },
      attendees: {
        select: {
          userId: true,
          user: { select: { notifications: true } },
        },
      },
      workspace: { select: { slug: true } },
    },
    take: 100,
  });

  // Batch-fetch workspace members for PUBLIC meetings (1 query for all)
  const publicWorkspaceIds = [...new Set(
    meetings.filter((m) => m.visibility === "PUBLIC").map((m) => m.workspaceId),
  )];
  const workspaceMembersMap = new Map<string, { userId: string; user: { notifications: boolean } }[]>();
  if (publicWorkspaceIds.length > 0) {
    const membersByWorkspace = await prisma.workspaceMember.findMany({
      where: { workspaceId: { in: publicWorkspaceIds } },
      select: {
        workspaceId: true,
        userId: true,
        user: { select: { notifications: true } },
      },
    });
    for (const m of membersByWorkspace) {
      if (!m.workspaceId) continue;
      const list = workspaceMembersMap.get(m.workspaceId) ?? [];
      list.push({ userId: m.userId, user: m.user });
      workspaceMembersMap.set(m.workspaceId, list);
    }
  }

  let sent = 0;
  for (const meeting of meetings) {
    let recipients: string[];
    if (meeting.visibility === "PRIVATE") {
      recipients = getPrivateRecipients(
        meeting.attendees,
        meeting.createdBy,
        meeting.createdById,
      );
    } else {
      recipients = getPublicRecipients(
        meeting.workspaceId ? (workspaceMembersMap.get(meeting.workspaceId) ?? []) : [],
      );
    }
    if (recipients.length === 0) continue;

    const pending = buildMeetingPendingNotifs(meeting, recipients, now);
    sent += await processPendingNotifications(pending);
  }

  console.log(
    `✅ Meeting reminder cron done — ${meetings.length} meetings scanned, ${sent} notifications queued`,
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function startMeetingReminderCron(): void {
  cron.schedule("*/15 * * * *", async () => {
    try {
      await runMeetingReminderCron();
    } catch (error) {
      console.error("❌ Meeting reminder cron failed:", error);
    }
  });
  console.log("✅ Meeting reminder cron started (every 15 min)");
}
