import { prisma } from "./prisma.js";

/**
 * Builds a JSON-serialisable bundle of everything tied to a user account,
 * used by the self-service data export (POST /api/v1/user/export-data).
 *
 * The bundle mirrors what the Privacy Policy promises: profile, workspaces,
 * projects, tasks, comments, focus sessions, time entries, notifications,
 * and activity. Date objects are kept as-is — JSON.stringify converts them
 * to ISO strings.
 */
export async function buildUserExportBundle(userId: string) {
  const [
    profile,
    ownedWorkspaces,
    memberWorkspaces,
    projects,
    tasks,
    comments,
    focusSessions,
    timeEntries,
    notifications,
    activity,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        timezone: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.workspace.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.workspace.findMany({
      where: {
        members: { some: { userId } },
        NOT: { ownerId: userId },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        plan: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: {
        OR: [{ createdById: userId }, { members: { some: { userId } } }],
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        slug: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: {
        OR: [{ createdById: userId }, { assignees: { some: { userId } } }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        projectId: true,
        workspaceId: true,
        dueDate: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.comment.findMany({
      where: { userId },
      select: {
        id: true,
        content: true,
        taskId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.focusSession.findMany({
      where: { userId },
      select: {
        id: true,
        duration: true,
        type: true,
        completed: true,
        startedAt: true,
        endedAt: true,
        taskId: true,
      },
      orderBy: { startedAt: "desc" },
      take: 1000,
    }),
    prisma.timeEntry.findMany({
      where: { userId },
      select: {
        id: true,
        description: true,
        duration: true,
        billable: true,
        category: true,
        startedAt: true,
        endedAt: true,
        taskId: true,
      },
      orderBy: { startedAt: "desc" },
      take: 1000,
    }),
    prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        read: true,
        actionUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.activity.findMany({
      where: { userId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        workspaceId: true,
        workspaceSlug: true,
        taskId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    workspaces: {
      owned: ownedWorkspaces,
      member: memberWorkspaces,
    },
    projects,
    tasks,
    comments,
    focusSessions,
    timeEntries,
    notifications,
    activity,
  };
}
