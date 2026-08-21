/**
 * src/modules/notification/project.cron.ts
 *
 * Project deadline notification crons.
 * Handles project due-soon reminders, overdue alerts, and auto-archiving.
 *
 * Reminder schedule:
 *   - PROJECT_DUE_SOON: 7d, 3d, 1d before due date
 *   - PROJECT_OVERDUE: Daily after due date
 *   - PROJECT_AUTO_ARCHIVED: 7 days after due date if no activity
 *
 * Recipients:
 *   - Due-soon/Overdue: Project managers + workspace owners/admins
 *   - Auto-archived: All project members + workspace owners/admins
 */

import cron from "node-cron";
import type { NotificationType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notifyUsers } from "./notification.helpers.js";
import {
  processPendingNotifications,
  DEDUP_PREFIX,
  type PendingNotification,
} from "./cron.utils.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Project reminder thresholds (days before due) */
const PROJECT_REMINDERS = [
  { label: "7d", days: 7 },
  { label: "3d", days: 3 },
  { label: "1d", days: 1 },
] as const;

/** Auto-archive grace period (days after due date) */
const AUTO_ARCHIVE_DAYS = 7;

/** Redis key prefix for project dedup */
const PROJECT_DEDUP_PREFIX = `${DEDUP_PREFIX}project:`;

// ─── Get project notification recipients ─────────────────────────────────────

async function getProjectRecipients(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        where: { role: "MANAGER" },
        select: { userId: true },
      },
      workspace: {
        include: {
          members: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          },
        },
      },
    },
  });

  if (!project) return [];

  const recipients = new Set<string>();

  // Add project managers
  for (const member of project.members) {
    recipients.add(member.userId);
  }

  // Add workspace owners and admins
  if (project.workspace) {
    for (const member of project.workspace.members) {
      recipients.add(member.userId);
    }
  }

  return Array.from(recipients);
}

// ─── Get all project stakeholders (for auto-archive) ─────────────────────────

async function getAllProjectStakeholders(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        select: { userId: true },
      },
      workspace: {
        include: {
          members: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          },
        },
      },
    },
  });

  if (!project) return [];

  const recipients = new Set<string>();

  // Add ALL project members
  for (const member of project.members) {
    recipients.add(member.userId);
  }

  // Add workspace owners and admins
  if (project.workspace) {
    for (const member of project.workspace.members) {
      recipients.add(member.userId);
    }
  }

  return Array.from(recipients);
}

// ─── Build project due-soon notifications ────────────────────────────────────

function buildProjectPendingNotifs(
  project: { id: string; name: string; slug: string; dueDate: Date | null; workspace?: { slug: string } | null },
  recipients: string[],
  now: number,
): PendingNotification[] {
  if (!project.dueDate) return [];
  const due = project.dueDate.getTime();
  const pending: PendingNotification[] = [];
  const actionUrl = project.workspace
    ? `/dashboard/workspaces/${project.workspace.slug}/projects/${project.slug}`
    : `/dashboard/projects/${project.slug}`;

  // Due-soon reminders
  for (const r of PROJECT_REMINDERS) {
    const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    if (daysUntilDue > 0 && daysUntilDue <= r.days + 1) {
      for (const userId of recipients) {
        pending.push({
          dedupKey: `${PROJECT_DEDUP_PREFIX}${project.id}:${userId}:DUE_SOON:${r.label}`,
          userId,
          type: "PROJECT_DUE_SOON",
          title: "Project Due Soon",
          message: `Project "${project.name}" is due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`,
          actionUrl,
        });
      }
    }
  }

  // Overdue notifications
  const daysOverdue = Math.abs(Math.floor((due - now) / (1000 * 60 * 60 * 24)));
  if (daysOverdue > 0) {
    for (const userId of recipients) {
      pending.push({
        dedupKey: `${PROJECT_DEDUP_PREFIX}${project.id}:${userId}:OVERDUE`,
        userId,
        type: "PROJECT_OVERDUE",
        title: "Project Overdue",
        message: `Project "${project.name}" is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue`,
        actionUrl,
      });
    }
  }

  return pending;
}

// ─── Project reminder cron ───────────────────────────────────────────────────

async function runProjectReminderCron(): Promise<void> {
  const now = Date.now();
  const maxReminderDays = Math.max(...PROJECT_REMINDERS.map((r) => r.days));
  const maxReminderDate = new Date(now + maxReminderDays * 24 * 60 * 60 * 1000);

  // Find active projects with due dates approaching
  // Include project managers + workspace owners/admins in the query
  // to avoid N+1 DB calls per project.
  const projects = await prisma.project.findMany({
    where: {
      dueDate: {
        not: null,
        gt: new Date(now),
        lte: maxReminderDate,
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      slug: true,
      dueDate: true,
      workspace: {
        select: {
          slug: true,
          members: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          },
        },
      },
      members: {
        where: { role: "MANAGER" },
        select: { userId: true },
      },
    },
    take: 100,
  });

  let sent = 0;
  for (const project of projects) {
    if (!project.dueDate) continue;

    // Build recipients inline — no extra DB call needed
    const recipientSet = new Set<string>();
    for (const m of project.members) recipientSet.add(m.userId);
    if (project.workspace) {
      for (const m of project.workspace.members) recipientSet.add(m.userId);
    }
    const recipients = Array.from(recipientSet);
    if (recipients.length === 0) continue;

    const pending = buildProjectPendingNotifs(project, recipients, now);
    sent += await processPendingNotifications(pending);
  }

  console.log(
    `✅ Project reminder cron done — ${projects.length} projects scanned, ${sent} notifications queued`,
  );
}

// ─── Project auto-archive cron ───────────────────────────────────────────────

async function runProjectAutoArchiveCron(): Promise<void> {
  const now = Date.now();
  const cutoffDate = new Date(now - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);

  // Find active projects that are past due + grace period
  const projects = await prisma.project.findMany({
    where: {
      dueDate: {
        not: null,
        lt: cutoffDate,
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      slug: true,
      dueDate: true,
      updatedAt: true,
      workspace: {
        select: {
          slug: true,
          members: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          },
        },
      },
      members: {
        select: { userId: true },
      },
    },
    take: 100,
  });

  // Batch: find all project IDs that have recent task activity
  // (single query instead of N queries)
  const projectIds = projects.map((p) => p.id);
  const recentTaskProjectIds = new Set(
    (
      await prisma.task.groupBy({
        by: ["projectId"],
        where: {
          projectId: { in: projectIds },
          updatedAt: { gte: new Date(now - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
      })
    ).map((r) => r.projectId),
  );

  const cutoffMs = now - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  let archived = 0;
  for (const project of projects) {
    // Skip if there's been recent task activity
    if (recentTaskProjectIds.has(project.id)) continue;

    // Skip if project itself was recently updated (in-memory, no DB call)
    if (project.updatedAt.getTime() >= cutoffMs) continue;

    // Archive the project
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "ARCHIVED" },
    });

    // Build stakeholders inline — members already fetched in the initial query
    const stakeholderSet = new Set<string>();
    for (const m of project.members) stakeholderSet.add(m.userId);
    if (project.workspace) {
      for (const m of project.workspace.members) stakeholderSet.add(m.userId);
    }
    const stakeholders = Array.from(stakeholderSet);

    const actionUrl = project.workspace
      ? `/dashboard/workspaces/${project.workspace.slug}/projects/${project.slug}`
      : `/dashboard/projects/${project.slug}`;

    // Send auto-archive notifications
    await notifyUsers(
      stakeholders.map((userId) => ({
        userId,
        type: "PROJECT_AUTO_ARCHIVED" as NotificationType,
        title: "Project Auto-Archived",
        message: `Project "${project.name}" has been automatically archived due to inaction after the due date`,
        actionUrl,
      })),
    );

    archived++;
    console.log(`  📦 Archived project "${project.name}" (${project.id})`);
  }

  console.log(
    `✅ Project auto-archive cron done — ${projects.length} projects checked, ${archived} archived`,
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function startProjectReminderCron(): void {
  cron.schedule("0 * * * *", async () => {
    try {
      await runProjectReminderCron();
    } catch (error) {
      console.error("❌ Project reminder cron failed:", error);
    }
  });
  console.log("✅ Project reminder cron started (every hour)");
}

export function startProjectAutoArchiveCron(): void {
  cron.schedule("0 */12 * * *", async () => {
    try {
      await runProjectAutoArchiveCron();
    } catch (error) {
      console.error("❌ Project auto-archive cron failed:", error);
    }
  });
  console.log("✅ Project auto-archive cron started (every 12 hours)");
}
