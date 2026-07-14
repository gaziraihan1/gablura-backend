import { prisma } from "../../lib/prisma.js";
import {
  notifyUser,
  notifyWorkspaceMembers,
} from "../notification/notification.helpers.js";
import type { MeetingPayload } from "./meeting.select.js";
import { addSendNotificationJob, addNotifyWorkspaceMembersJob } from "../../queue/index.js";

function formatMeetingTime(date: Date): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Add this helper at the top
async function getWorkspaceSlug(workspaceId: string): Promise<string> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true },
  });
  return workspace?.slug ?? workspaceId; // fallback to id if not found
}

export async function notifyMeetingCreatedPrivate(params: {
  meeting: MeetingPayload;
  workspaceId: string;  
  senderId: string;
  senderName: string;
}) {
  const { meeting, workspaceId, senderId, senderName } = params;
  const slug = await getWorkspaceSlug(workspaceId);
  const attendeeIds = meeting.attendees
    .map((a) => a.userId)
    .filter((id) => id !== senderId);

  if (!attendeeIds.length) return;

  const users = await prisma.user.findMany({
    where: { id: { in: attendeeIds } },
    select: { id: true, notifications: true },
  });

  await Promise.allSettled(
    users
      .filter((u) => u.notifications)
      .map((u) =>
        addSendNotificationJob({
          userId: u.id,
          senderId,
          type: "MEETING_CREATED",
          title: "You have been invited to a meeting",
          message: `${senderName} invited you to "${meeting.title}" on ${formatMeetingTime(new Date(meeting.startTime))}`,
          actionUrl: `/dashboard/workspaces/${slug}/meetings/${meeting.id}`,
        }),
      ),
  );
}

export async function notifyMeetingCreatedPublic(params: {
  meeting: MeetingPayload;
  workspaceId: string;
  senderId: string;
  senderName: string;
}) {
  const { meeting, workspaceId, senderId, senderName } = params;
  const slug = await getWorkspaceSlug(workspaceId);

  await addNotifyWorkspaceMembersJob({
    workspaceId,
    senderId,
    type: "MEETING_CREATED",
    title: "New meeting scheduled",
    message: `${senderName} scheduled "${meeting.title}" on ${formatMeetingTime(new Date(meeting.startTime))}`,
    actionUrl: `/dashboard/workspaces/${slug}/meetings/${meeting.id}`,
    excludeUserId: senderId,
  });
}

export async function notifyMeetingUpdated(params: {
  meeting: MeetingPayload;
  workspaceId: string;
  senderId: string;
  senderName: string;
  isAdmin: boolean;
}) {
  const { meeting, workspaceId, senderId, senderName, isAdmin } = params;
  const slug = await getWorkspaceSlug(workspaceId);

  if (meeting.visibility === "PUBLIC" && isAdmin) {
    await addNotifyWorkspaceMembersJob({
      workspaceId,
      senderId,
      type: "MEETING_UPDATED",
      title: "Meeting updated",
      message: `${senderName} updated "${meeting.title}"`,
      actionUrl: `/dashboard/workspaces/${slug}/meetings/${meeting.id}`,
      excludeUserId: senderId,
    });
  } else {
    const attendeeIds = meeting.attendees
      .map((a) => a.userId)
      .filter((id) => id !== senderId);

    if (!attendeeIds.length) return;

    const users = await prisma.user.findMany({
      where: { id: { in: attendeeIds } },
      select: { id: true, notifications: true },
    });

    await Promise.allSettled(
      users
        .filter((u) => u.notifications)
        .map((u) =>
          addSendNotificationJob({
            userId: u.id,
            senderId,
            type: "MEETING_UPDATED",
            title: "Meeting updated",
            message: `${senderName} updated "${meeting.title}"`,
            actionUrl: `/dashboard/workspaces/${slug}/meetings/${meeting.id}`,
          }),
        ),
    );
  }
}

export async function notifyMeetingCancelled(params: {
  meeting: MeetingPayload;
  workspaceId: string;
  senderId: string;
  senderName: string;
}) {
  const { meeting, workspaceId, senderId, senderName } = params;
  const slug = await getWorkspaceSlug(workspaceId);

  if (meeting.visibility === "PUBLIC") {
    await addNotifyWorkspaceMembersJob({
      workspaceId,
      senderId,
      type: "MEETING_CANCELLED",
      title: "Meeting cancelled",
      message: `${senderName} cancelled "${meeting.title}"`,
      actionUrl: `/dashboard/workspaces/${slug}/meetings`,
      excludeUserId: senderId,
    });
  } else {
    const attendeeIds = meeting.attendees
      .map((a) => a.userId)
      .filter((id) => id !== senderId);

    if (!attendeeIds.length) return;

    const users = await prisma.user.findMany({
      where: { id: { in: attendeeIds } },
      select: { id: true, notifications: true },
    });

    await Promise.allSettled(
      users
        .filter((u) => u.notifications)
        .map((u) =>
          addSendNotificationJob({
            userId: u.id,
            senderId,
            type: "MEETING_CANCELLED",
            title: "Meeting cancelled",
            message: `${senderName} cancelled "${meeting.title}"`,
            actionUrl: `/dashboard/workspaces/${slug}/meetings`,
          }),
        ),
    );
  }
}