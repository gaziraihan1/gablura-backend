import { prisma } from '../lib/prisma.js';
import type {
  AdminStats,
  AdminWorkspace,
  AdminWorkspaceDetail,
  AdminUser,
  AdminUserDetail,
  AdminProject,
  AdminActivity,
  AdminBilling,
  AdminPaginationParams,
  PaginatedAdminResult,
  WorkspacePlan
} from './admin.types.js';

function paginate(page = 1, pageSize = 20) {
  const p  = Math.max(1, page);
  const ps = Math.min(100, Math.max(1, pageSize));
  return { page: p, pageSize: ps, skip: (p - 1) * ps };
}

function buildPagination(page: number, pageSize: number, totalCount: number) {
  const totalPages = Math.ceil(totalCount / pageSize);
  return {
    page, pageSize, totalCount, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export const AdminRepository = {

  // ── Overview stats ─────────────────────────────────────────────────────────
  async getStats(): Promise<AdminStats> {
    const [
      totalUsers,
      totalWorkspaces,
      totalProjects,
      totalTasks,
      totalAnnouncements,
      totalMeetings,
      planDistribution,
      featureGroups,
      recentSignups,
      recentWorkspaces,
      storageStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.project.count(),
      prisma.task.count(),
      prisma.announcement.count(),
      prisma.meeting.count(),
      // WorkspacePlan enum groupBy
      prisma.workspace.groupBy({
        by:      ['plan'],
        _count:  { plan: true },
        orderBy: { _count: { plan: 'desc' } },
      }),
      prisma.featureRequest.groupBy({
        by:     ['status'],
        _count: { status: true },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take:    5,
        select: {
          id: true, name: true, email: true,
          image: true, createdAt: true,
        },
      }),
      prisma.workspace.findMany({
        orderBy: { createdAt: 'desc' },
        take:    5,
        select: {
          id: true, name: true, slug: true, plan: true, createdAt: true,
          owner:  { select: { id: true, name: true, email: true } },
          _count: { select: { members: true, projects: true } },
        },
      }),
      // Total storage used across all workspaces (sum of file sizes)
      prisma.file.aggregate({ _sum: { size: true } }),
    ]);

    const frMap = Object.fromEntries(
      featureGroups.map((f) => [f.status, f._count.status]),
    );

    return {
      totals: {
        users:         totalUsers,
        workspaces:    totalWorkspaces,
        projects:      totalProjects,
        tasks:         totalTasks,
        announcements: totalAnnouncements,
        meetings:      totalMeetings,
      },
      plans: planDistribution.map((p) => ({
        plan:  p.plan,
        count: p._count.plan,
      })),
      featureRequests: {
        pending:   frMap['PENDING']   ?? 0,
        approved:  frMap['APPROVED']  ?? 0,
        planned:   frMap['PLANNED']   ?? 0,
        completed: frMap['COMPLETED'] ?? 0,
        rejected:  frMap['REJECTED']  ?? 0,
      },
      totalStorageUsedMb: Math.round(
        (storageStats._sum.size ?? 0) / (1024 * 1024),
      ),
      recentSignups: recentSignups.map((u) => ({
        ...u,
        name: u.name ?? 'Unknown',
      })),
      recentWorkspaces: recentWorkspaces.map((w) => ({
        ...w,
        owner: { ...w.owner, name: w.owner.name ?? 'Unknown' },
      })),
    };
  },

  // ── Workspaces list ────────────────────────────────────────────────────────
  async getWorkspaces(
    params: AdminPaginationParams,
  ): Promise<PaginatedAdminResult<AdminWorkspace>> {
    const { page, pageSize, skip } = paginate(params.page, params.pageSize);

    const where = params.search
      ? {
          OR: [
            { name:  { contains: params.search, mode: 'insensitive' as const } },
            { slug:  { contains: params.search, mode: 'insensitive' as const } },
            { owner: { email: { contains: params.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const [rows, totalCount] = await Promise.all([
      prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true, name: true, slug: true,
          plan: true, createdAt: true,
          maxMembers: true, maxStorage: true,
          owner: { select: { id: true, name: true, email: true, image: true } },
          subscription: {
            select: {
              status: true, billingCycle: true,
              currentPeriodEnd: true, cancelAtPeriodEnd: true,
              plan: { select: { displayName: true, monthlyPriceCents: true } },
            },
          },
          _count: { select: { members: true, projects: true, tasks: true } },
        },
      }),
      prisma.workspace.count({ where }),
    ]);

    // Storage used per workspace — one aggregation query, not N queries
    const wsIds = rows.map((r) => r.id);
    const storageRows = await prisma.file.groupBy({
      by:    ['workspaceId'],
      where: { workspaceId: { in: wsIds } },
      _sum:  { size: true },
    });
    const storageMap = Object.fromEntries(
      storageRows.map((s) => [
        s.workspaceId,
        Math.round((s._sum.size ?? 0) / (1024 * 1024)),
      ]),
    );

    return {
      data: rows.map((r) => ({
        id:         r.id,
        name:       r.name,
        slug:       r.slug,
        plan:       r.plan,
        createdAt:  r.createdAt,
        maxMembers: r.maxMembers,
        maxStorageMb: r.maxStorage,
        usedStorageMb: storageMap[r.id] ?? 0,
        owner: { ...r.owner, name: r.owner.name ?? 'Unknown' },
        subscription: r.subscription
          ? {
              status:           r.subscription.status,
              billingCycle:     r.subscription.billingCycle,
              currentPeriodEnd: r.subscription.currentPeriodEnd,
              cancelAtPeriodEnd: r.subscription.cancelAtPeriodEnd,
              planName:         r.subscription.plan.displayName,
              monthlyPriceCents: r.subscription.plan.monthlyPriceCents,
            }
          : null,
        _count: r._count,
      })),
      pagination: buildPagination(page, pageSize, totalCount),
    };
  },

  // ── Workspace detail by SLUG ───────────────────────────────────────────────
  async getWorkspaceDetailBySlug(slug: string): Promise<AdminWorkspaceDetail | null> {
    const raw = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, plan: true, description: true,
        createdAt: true, updatedAt: true,
        maxMembers: true, maxStorage: true,
        deletedAt: true, deletedById: true, deleteReason: true,
        owner: { select: { id: true, name: true, email: true, image: true } },
        subscription: {
          select: {
            id: true, status: true, billingCycle: true,
            currentPeriodStart: true, currentPeriodEnd: true,
            cancelAtPeriodEnd: true, canceledAt: true,
            stripeCustomerId: true,
            plan: {
              select: {
                id: true, name: true, displayName: true,
                monthlyPriceCents: true, yearlyPriceCents: true,
                maxMembersPerWs: true, maxStorageMb: true,
                maxProjects: true, maxMeetingsPerMo: true,
                analyticsAccess: true, prioritySupport: true,
                apiAccess: true,
              },
            },
            invoices: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true, stripeInvoiceId: true, amountPaid: true,
                currency: true, status: true, paidAt: true,
                invoicePdf: true, periodStart: true, periodEnd: true,
              },
            },
          },
        },
        members: {
          orderBy: { joinedAt: 'asc' },
          select: {
            id: true, role: true, joinedAt: true,
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        },
        projects: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, name: true, slug: true, status: true,
            priority: true, createdAt: true,
            createdBy: { select: { id: true, name: true } },
            _count: { select: { tasks: true, members: true } },
          },
        },
        // Storage breakdown
        files: {
          select: { size: true, mimeType: true },
        },
        _count: {
          select: {
            members: true, projects: true,
            tasks: true, meetings: true, announcements: true,
          },
        },
      },
    });

    if (!raw) return null;

    // Compute storage used
    const usedStorageMb = Math.round(
      raw.files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024),
    );

    return {
      id:          raw.id,
      name:        raw.name,
      slug:        raw.slug,
      plan:        raw.plan,
      description: raw.description,
      createdAt:   raw.createdAt,
      updatedAt:   raw.updatedAt,
      maxMembers:  raw.maxMembers,
      maxStorageMb:  raw.maxStorage,
      usedStorageMb,
      owner: { ...raw.owner, name: raw.owner.name ?? 'Unknown' },
      subscription: raw.subscription
        ? {
            ...raw.subscription,
            invoices: raw.subscription.invoices,
          }
        : null,
      members: raw.members.map((m) => ({
        ...m,
        role: m.role as string,
        user: { ...m.user, name: m.user.name ?? 'Unknown' },
      })),
      projects: raw.projects.map((p) => ({
        ...p,
        createdBy: { ...p.createdBy, name: p.createdBy.name ?? 'Unknown' },
      })),
      _count: raw._count,
    };
  },
  async updateWorkspaceLimits(
  workspaceId: string,
  data: { plan: WorkspacePlan; maxMembers: number; maxStorage: number },
): Promise<{ id: string; slug: string; name: string; plan: WorkspacePlan; maxMembers: number; maxStorage: number }> {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      id: true, slug: true, name: true,
      plan: true, maxMembers: true, maxStorage: true,
    },
  });
},

  // ── Users list ─────────────────────────────────────────────────────────────
  async getUsers(
    params: AdminPaginationParams,
  ): Promise<PaginatedAdminResult<AdminUser>> {
    const { page, pageSize, skip } = paginate(params.page, params.pageSize);

    const where = params.search
      ? {
          OR: [
            { name:  { contains: params.search, mode: 'insensitive' as const } },
            { email: { contains: params.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true, name: true, email: true, image: true,
          role: true, createdAt: true, lastLoginAt: true,
          _count: {
            select: {
              ownedWorkspaces:  true,  // workspaces they OWN
              workspaceMembers: true,  // workspaces they're a member of
              createdTasks:     true,
              comments:         true,
              focusSessions:    true,
              FeatureRequest:   true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id:          r.id,
        name:        r.name  ?? 'Unknown',
        email:       r.email,
        image:       r.image ?? null,
        role:        r.role,
        createdAt:   r.createdAt,
        lastLoginAt: r.lastLoginAt ?? null,
        _count: {
          ownedWorkspaces:   r._count.ownedWorkspaces,
          workspaceMember:   r._count.workspaceMembers,
          createdTasks:      r._count.createdTasks,
          comments:          r._count.comments,
          focusSessions:     r._count.focusSessions,
          featureRequests:   r._count.FeatureRequest,
        },
      })),
      pagination: buildPagination(page, pageSize, totalCount),
    };
  },

  // ── User detail ────────────────────────────────────────────────────────────
  async getUserDetail(id: string): Promise<AdminUserDetail | null> {
    const [user, taskStats, storageUsed] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true, name: true, email: true, image: true,
          role: true, bio: true, timezone: true,
          bannedAt: true, bannedById: true, banReason: true,
          createdAt: true, lastLoginAt: true, lastProfileUpdateAt: true,
          // Workspaces they own
          ownedWorkspaces: {
            select: {
              id: true, name: true, slug: true, plan: true,
              _count: { select: { members: true, projects: true } },
            },
          },
          // Workspaces they're a member of
          workspaceMembers: {
            select: {
              role: true, joinedAt: true,
              workspace: { select: { id: true, name: true, slug: true, plan: true } },
            },
          },
          // Recent tasks created
          createdTasks: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true, title: true, status: true,
              priority: true, createdAt: true,
              project:   { select: { id: true, name: true } },
              workspace: { select: { id: true, name: true } },
            },
          },
          // Project memberships
          projectMembers: {
            select: {
              role: true, joinedAt: true,
              project: {
                select: {
                  id: true, name: true, slug: true, status: true,
                  workspace: { select: { id: true, name: true } },
                },
              },
            },
          },
          // Feature requests submitted
          FeatureRequest: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, title: true, status: true, createdAt: true },
          },
          _count: {
            select: {
              ownedWorkspaces:  true,
              workspaceMembers: true,
              createdTasks:     true,
              assignedTasks:    true,
              comments:         true,
              focusSessions:    true,
              FeatureRequest:   true,
              files:            true,
            },
          },
        },
      }),
      // Task completion stats for this user
      prisma.task.groupBy({
        by:    ['status'],
        where: { createdById: id },
        _count: { status: true },
      }),
      // Storage this user has uploaded
      prisma.file.aggregate({
        where:  { uploadedById: id },
        _sum:   { size: true },
        _count: { id: true },
      }),
    ]);

    if (!user) return null;

    const taskStatusMap = Object.fromEntries(
      taskStats.map((t) => [t.status, t._count.status]),
    );

    // Keep API contract stable: membership objects in admin types require
    // concrete workspace/project.workspace relations.
    const workspaceMemberships = user.workspaceMembers
      .map((m) => {
        if (!m.workspace) return null;
        return {
          role: m.role as string,
          joinedAt: m.joinedAt,
          workspace: {
            id: m.workspace.id,
            name: m.workspace.name,
            slug: m.workspace.slug,
            plan: m.workspace.plan as string,
          },
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const projectMemberships = user.projectMembers
      .map((m) => {
        if (!m.project.workspace) return null;
        return {
          role: m.role as string,
          joinedAt: m.joinedAt,
          project: {
            id: m.project.id,
            name: m.project.name,
            slug: m.project.slug,
            status: m.project.status as string,
            workspace: {
              id: m.project.workspace.id,
              name: m.project.workspace.name,
            },
          },
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return {
      id:                  user.id,
      name:                user.name  ?? 'Unknown',
      email:               user.email,
      image:               user.image ?? null,
      role:                user.role,
      bio:                 user.bio   ?? null,
      timezone:            user.timezone ?? null,
      createdAt:           user.createdAt,
      lastLoginAt:         user.lastLoginAt        ?? null,
      lastProfileUpdateAt: user.lastProfileUpdateAt ?? null,
      ownedWorkspaces:     user.ownedWorkspaces,
      workspaceMemberships,
      projectMemberships,
      recentTasks:      user.createdTasks,
      featureRequests:  user.FeatureRequest,
      taskStats: {
        total:      user._count.createdTasks,
        todo:       taskStatusMap['TODO']        ?? 0,
        inProgress: taskStatusMap['IN_PROGRESS'] ?? 0,
        completed:  taskStatusMap['COMPLETED']   ?? 0,
        cancelled:  taskStatusMap['CANCELLED']   ?? 0,
      },
      storage: {
        usedMb:    Math.round((storageUsed._sum.size ?? 0) / (1024 * 1024)),
        fileCount: storageUsed._count.id,
      },
      _count: {
        ownedWorkspaces:  user._count.ownedWorkspaces,
        workspaceMember:  user._count.workspaceMembers,
        createdTasks:     user._count.createdTasks,
        assignedTasks:    user._count.assignedTasks,
        comments:         user._count.comments,
        focusSessions:    user._count.focusSessions,
        featureRequests:  user._count.FeatureRequest,
        files:            user._count.files,
      },
    };
  },

  // ── Projects list ──────────────────────────────────────────────────────────
  async getProjects(
    params: AdminPaginationParams & { workspaceId?: string },
  ): Promise<PaginatedAdminResult<AdminProject>> {
    const { page, pageSize, skip } = paginate(params.page, params.pageSize);

    const where = {
      ...(params.workspaceId && { workspaceId: params.workspaceId }),
      ...(params.search && {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' as const } },
          { slug: { contains: params.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [rows, totalCount] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true, name: true, slug: true, status: true,
          priority: true, createdAt: true, dueDate: true, completedAt: true,
          workspace: { select: { id: true, name: true, slug: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          members: {
            where: { role: 'MANAGER' },
            take:  1,
            select: {
              role: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { tasks: true, members: true, files: true } },
        },
      }),
      prisma.project.count({ where }),
    ]);

    // Task status breakdown for all returned projects — one query
    const projectIds = rows.map((r) => r.id);
    const taskBreakdown = await prisma.task.groupBy({
      by:    ['projectId', 'status'],
      where: { projectId: { in: projectIds } },
      _count: { status: true },
    });

    // Build map: projectId → { status: count }
    const taskMap: Record<string, Record<string, number>> = {};
    taskBreakdown.forEach((t) => {
      if (!t.projectId) return;
      taskMap[t.projectId] ??= {};
      taskMap[t.projectId][t.status] = t._count.status;
    });
    console.log("Task breakdown map:", rows); // Debugging log

    return {
      data: rows
        .map((r) => {
          if (!r.workspace) return null;
          return {
            id:          r.id,
            name:        r.name,
            slug:        r.slug,
            status:      r.status as string,
            priority:    r.priority as string,
            createdAt:   r.createdAt,
            dueDate:     r.dueDate   ?? null,
            completedAt: r.completedAt ?? null,
            workspace:   r.workspace,
            createdBy:   { ...r.createdBy, name: r.createdBy.name ?? 'Unknown' },
            manager:     r.members[0]
              ? { ...r.members[0].user, name: r.members[0].user.name ?? 'Unknown' }
              : null,
            taskBreakdown: {
              total:      r._count.tasks,
              todo:       taskMap[r.id]?.['TODO']        ?? 0,
              inProgress: taskMap[r.id]?.['IN_PROGRESS'] ?? 0,
              completed:  taskMap[r.id]?.['COMPLETED']   ?? 0,
              cancelled:  taskMap[r.id]?.['CANCELLED']   ?? 0,
            },
            _count: r._count,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
      pagination: buildPagination(page, pageSize, totalCount),
    };
  },

  // ── Billing overview ───────────────────────────────────────────────────────
  async getBilling(
    params: AdminPaginationParams,
  ): Promise<PaginatedAdminResult<AdminBilling>> {
    const { page, pageSize, skip } = paginate(params.page, params.pageSize);

    const where = params.search
      ? {
          OR: [
            { workspace: { name:  { contains: params.search, mode: 'insensitive' as const } } },
            { workspace: { owner: { email: { contains: params.search, mode: 'insensitive' as const } } } },
          ],
        }
      : {};

    const [rows, totalCount] = await Promise.all([
      prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true, status: true, billingCycle: true,
          currentPeriodStart: true, currentPeriodEnd: true,
          cancelAtPeriodEnd: true, canceledAt: true,
          stripeSubscriptionId: true, stripeCustomerId: true,
          plan: {
            select: {
              id: true, name: true, displayName: true,
              monthlyPriceCents: true, yearlyPriceCents: true,
            },
          },
          workspace: {
            select: {
              id: true, name: true, slug: true, plan: true,
              owner: { select: { id: true, name: true, email: true } },
            },
          },
          invoices: {
            orderBy: { createdAt: 'desc' },
            take:    3,
            select: {
              id: true, amountPaid: true, currency: true,
              status: true, paidAt: true, invoicePdf: true,
            },
          },
        },
      }),
      prisma.subscription.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        subscriptionId:       r.id,
        stripeSubscriptionId: r.stripeSubscriptionId,
        stripeCustomerId:     r.stripeCustomerId,
        status:               r.status,
        billingCycle:         r.billingCycle,
        currentPeriodStart:   r.currentPeriodStart,
        currentPeriodEnd:     r.currentPeriodEnd,
        cancelAtPeriodEnd:    r.cancelAtPeriodEnd,
        canceledAt:           r.canceledAt ?? null,
        plan:                 r.plan,
        workspace: {
          ...r.workspace,
          owner: { ...r.workspace.owner, name: r.workspace.owner.name ?? 'Unknown' },
        },
        recentInvoices: r.invoices,
      })),
      pagination: buildPagination(page, pageSize, totalCount),
    };
  },

  // ── Activity feed ──────────────────────────────────────────────────────────
  async getActivity(
    params: AdminPaginationParams,
  ): Promise<PaginatedAdminResult<AdminActivity>> {
    const { page, pageSize, skip } = paginate(params.page, params.pageSize);

    const [rows, totalCount] = await Promise.all([
      prisma.activity.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true, action: true, entityType: true,
          entityId: true, createdAt: true, metadata: true,
          user:      { select: { id: true, name: true, email: true, image: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.activity.count(),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        user:      { ...r.user, name: r.user.name ?? 'Unknown' },
        workspace: r.workspace ?? null,
      })),
      pagination: buildPagination(page, pageSize, totalCount),
    };
  },
  // Add to AdminRepository

async banUser(
  userId:    string,
  adminId:   string,
  reason:    string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      bannedAt:   new Date(),
      banReason:  reason,
      bannedById: adminId,
    },
  });
},

async unbanUser(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      bannedAt:   null,
      banReason:  null,
      bannedById: null,
    },
  });
},

async softDeleteWorkspace(
  workspaceId: string,
  adminId:     string,
  reason?:     string,
): Promise<{ ownerEmail: string; ownerName: string; workspaceName: string }> {
  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      deletedAt:    new Date(),
      deletedById:  adminId,
      deleteReason: reason ?? null,
    },
    select: {
      name:  true,
      owner: { select: { email: true, name: true, id: true } },
    },
  });

  return {
    ownerEmail:    ws.owner.email,
    ownerName:     ws.owner.name  ?? 'User',
    workspaceName: ws.name,
  };
},

async hardDeleteWorkspace(
  workspaceId: string,
): Promise<{ ownerEmail: string; ownerName: string; workspaceName: string }> {
  // Fetch before delete for notification
  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: {
      name:  true,
      owner: { select: { id: true, email: true, name: true } },
    },
  });

  if (!ws) throw new Error('NOT_FOUND: Workspace not found');

  await prisma.workspace.delete({ where: { id: workspaceId } });

  return {
    ownerEmail:    ws.owner.email,
    ownerName:     ws.owner.name  ?? 'User',
    workspaceName: ws.name,
  };
},

async restoreWorkspace(workspaceId: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      deletedAt:    null,
      deletedById:  null,
      deleteReason: null,
    },
  });
},
};