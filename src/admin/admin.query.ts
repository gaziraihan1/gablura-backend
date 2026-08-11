import { prisma } from "../lib/prisma.js";
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
} from "./admin.types.js";

// ─── Pagination helpers ────────────────────────────────────────────────────────

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

// ─── Query functions ───────────────────────────────────────────────────────────

type MonthPoint = { label: string; count: number };

/**
 * Zero-filled per-month counts for the last 7 months (incl. current), driven by
 * the entity's `createdAt`. Table names come from a hardcoded allowlist, never
 * user input.
 */
function monthlyCounts(table: string): Promise<MonthPoint[]> {
  return prisma.$queryRawUnsafe<MonthPoint[]>(`
    SELECT to_char(d, 'Mon') AS label, COALESCE(c, 0)::int AS count
    FROM generate_series(
      date_trunc('month', now()) - interval '6 months',
      date_trunc('month', now()),
      interval '1 month'
    ) d
    LEFT JOIN (
      SELECT date_trunc('month', "createdAt") AS m, COUNT(*) AS c
      FROM "${table}" GROUP BY m
    ) t ON t.m = d
    ORDER BY d
  `);
}

export async function queryStats(): Promise<AdminStats> {
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
    growthUsers,
    growthWorkspaces,
    growthProjects,
    taskActivity,
    growthByPlan,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.project.count(),
    prisma.task.count(),
    prisma.announcement.count(),
    prisma.meeting.count(),
    prisma.workspace.groupBy({
      by:      ["plan"],
      _count:  { plan: true },
      orderBy: { _count: { plan: "desc" } },
    }),
    prisma.featureRequest.groupBy({
      by:     ["status"],
      _count: { status: true },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take:    5,
      select: {
        id: true, name: true, email: true,
        image: true, createdAt: true,
      },
    }),
    prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take:    5,
      select: {
        id: true, name: true, slug: true, plan: true, createdAt: true,
        owner:  { select: { id: true, name: true, email: true } },
        _count: { select: { members: true, projects: true } },
      },
    }),
    prisma.file.aggregate({ _sum: { size: true } }),
    monthlyCounts("User"),
    monthlyCounts("Workspace"),
    monthlyCounts("Project"),
    prisma.$queryRawUnsafe<
      { label: string; todo: number; inProgress: number; completed: number }[]
    >(`
      SELECT to_char(d, 'Dy') AS label,
        COUNT(*) FILTER (WHERE t.status = 'TODO')::int        AS todo,
        COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')::int AS "inProgress",
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED')::int   AS completed
      FROM generate_series(current_date - 6, current_date, interval '1 day') d
      -- Range predicates on the bare column keep the JOIN index-friendly
      -- while the LEFT JOIN still zero-fills days with no task activity.
      LEFT JOIN "Task" t
        ON t."createdAt" >= d::date AND t."createdAt" < d::date + interval '1 day'
      GROUP BY d
      ORDER BY d
    `),
    // Workspaces per month broken down by plan — same zero-filled series.
    prisma.$queryRawUnsafe<
      { label: string; FREE: number; PRO: number; BUSINESS: number; ENTERPRISE: number }[]
    >(`
      SELECT to_char(d, 'Mon') AS label,
        COALESCE(SUM(CASE WHEN t.plan = 'FREE' THEN 1 ELSE 0 END), 0)::int       AS "FREE",
        COALESCE(SUM(CASE WHEN t.plan = 'PRO' THEN 1 ELSE 0 END), 0)::int        AS "PRO",
        COALESCE(SUM(CASE WHEN t.plan = 'BUSINESS' THEN 1 ELSE 0 END), 0)::int   AS "BUSINESS",
        COALESCE(SUM(CASE WHEN t.plan = 'ENTERPRISE' THEN 1 ELSE 0 END), 0)::int AS "ENTERPRISE"
      FROM generate_series(
        date_trunc('month', now()) - interval '6 months',
        date_trunc('month', now()),
        interval '1 month'
      ) d
      LEFT JOIN "Workspace" t
        ON t."createdAt" >= d AND t."createdAt" < d + interval '1 month'
      GROUP BY d
      ORDER BY d
    `),
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
      pending:   frMap["PENDING"]   ?? 0,
      approved:  frMap["APPROVED"]  ?? 0,
      planned:   frMap["PLANNED"]   ?? 0,
      completed: frMap["COMPLETED"] ?? 0,
      rejected:  frMap["REJECTED"]  ?? 0,
    },
    totalStorageUsedMb: Math.round(
      (storageStats._sum.size ?? 0) / (1024 * 1024),
    ),
    recentSignups: recentSignups.map((u) => ({
      ...u,
      name: u.name ?? "Unknown",
    })),
    recentWorkspaces: recentWorkspaces.map((w) => ({
      ...w,
      owner: { ...w.owner, name: w.owner.name ?? "Unknown" },
    })),
    growth: growthUsers.map((p, i) => ({
      label:      p.label,
      users:      p.count,
      workspaces: growthWorkspaces[i]?.count ?? 0,
      projects:   growthProjects[i]?.count ?? 0,
    })),
    taskActivity: taskActivity.map((t) => ({
      label:      t.label,
      todo:       t.todo,
      inProgress: t.inProgress,
      completed:  t.completed,
    })),
    growthByPlan,
  };
}

export async function queryWorkspaces(
  params: AdminPaginationParams,
): Promise<PaginatedAdminResult<AdminWorkspace>> {
  const { page, pageSize, skip } = paginate(params.page, params.pageSize);

  const where = params.search
    ? {
        OR: [
          { name:  { contains: params.search, mode: "insensitive" as const } },
          { slug:  { contains: params.search, mode: "insensitive" as const } },
          { owner: { email: { contains: params.search, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const [rows, totalCount] = await Promise.all([
    prisma.workspace.findMany({
      where,
      orderBy: { createdAt: "desc" },
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

  // Storage per workspace — single aggregation, not N queries
  const wsIds = rows.map((r) => r.id);
  const storageRows = await prisma.file.groupBy({
    by:    ["workspaceId"],
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
      id:           r.id,
      name:         r.name,
      slug:         r.slug,
      plan:         r.plan,
      createdAt:    r.createdAt,
      maxMembers:   r.maxMembers,
      maxStorageMb: r.maxStorage,
      usedStorageMb: storageMap[r.id] ?? 0,
      owner: { ...r.owner, name: r.owner.name ?? "Unknown" },
      subscription: r.subscription
        ? {
            status:            r.subscription.status,
            billingCycle:      r.subscription.billingCycle,
            currentPeriodEnd:  r.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: r.subscription.cancelAtPeriodEnd,
            planName:          r.subscription.plan.displayName,
            monthlyPriceCents: r.subscription.plan.monthlyPriceCents,
          }
        : null,
      _count: r._count,
    })),
    pagination: buildPagination(page, pageSize, totalCount),
  };
}

export async function queryWorkspaceDetailBySlug(
  slug: string,
): Promise<AdminWorkspaceDetail | null> {
  const raw = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, plan: true, description: true,
      createdAt: true, updatedAt: true,
      maxMembers: true, maxStorage: true,
      aiDailyCalls: true, aiMonthlyTokens: true, aiMaxOutputTokens: true,
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
            orderBy: { createdAt: "desc" },
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
        orderBy: { joinedAt: "asc" },
        select: {
          id: true, role: true, joinedAt: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
      projects: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, slug: true, status: true,
          priority: true, createdAt: true,
          createdBy: { select: { id: true, name: true } },
          _count: { select: { tasks: true, members: true } },
        },
      },
      files: { select: { size: true, mimeType: true } },
      _count: {
        select: {
          members: true, projects: true,
          tasks: true, meetings: true, announcements: true,
        },
      },
    },
  });

  if (!raw) return null;

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
    aiDailyCalls: raw.aiDailyCalls,
    aiMonthlyTokens: raw.aiMonthlyTokens,
    aiMaxOutputTokens: raw.aiMaxOutputTokens,
    usedStorageMb,
    owner: { ...raw.owner, name: raw.owner.name ?? "Unknown" },
    subscription: raw.subscription
      ? { ...raw.subscription, invoices: raw.subscription.invoices }
      : null,
    members: raw.members.map((m) => ({
      ...m,
      role: m.role as string,
      user: { ...m.user, name: m.user.name ?? "Unknown" },
    })),
    projects: raw.projects.map((p) => ({
      ...p,
      createdBy: { ...p.createdBy, name: p.createdBy.name ?? "Unknown" },
    })),
    _count: raw._count,
  };
}

export async function queryUsers(
  params: AdminPaginationParams,
): Promise<PaginatedAdminResult<AdminUser>> {
  const { page, pageSize, skip } = paginate(params.page, params.pageSize);

  const where = params.search
    ? {
        OR: [
          { name:  { contains: params.search, mode: "insensitive" as const } },
          { email: { contains: params.search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [rows, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true, name: true, email: true, image: true,
        role: true, createdAt: true, lastLoginAt: true,
        _count: {
          select: {
            ownedWorkspaces:  true,
            workspaceMembers: true,
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
      name:        r.name  ?? "Unknown",
      email:       r.email,
      image:       r.image ?? null,
      role:        r.role,
      createdAt:   r.createdAt,
      lastLoginAt: r.lastLoginAt ?? null,
      _count: {
        ownedWorkspaces:  r._count.ownedWorkspaces,
        workspaceMember:  r._count.workspaceMembers,
        createdTasks:     r._count.createdTasks,
        comments:         r._count.comments,
        focusSessions:    r._count.focusSessions,
        featureRequests:  r._count.FeatureRequest,
      },
    })),
    pagination: buildPagination(page, pageSize, totalCount),
  };
}

export async function queryUserDetail(
  id: string,
): Promise<AdminUserDetail | null> {
  const [user, taskStats, storageUsed] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, image: true,
        role: true, bio: true, timezone: true,
        bannedAt: true, bannedById: true, banReason: true,
        createdAt: true, lastLoginAt: true, lastProfileUpdateAt: true,
        ownedWorkspaces: {
          select: {
            id: true, name: true, slug: true, plan: true,
            _count: { select: { members: true, projects: true } },
          },
        },
        workspaceMembers: {
          select: {
            role: true, joinedAt: true,
            workspace: { select: { id: true, name: true, slug: true, plan: true } },
          },
        },
        createdTasks: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true, title: true, status: true,
            priority: true, createdAt: true,
            project:   { select: { id: true, name: true } },
            workspace: { select: { id: true, name: true } },
          },
        },
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
        FeatureRequest: {
          orderBy: { createdAt: "desc" },
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
    prisma.task.groupBy({
      by:    ["status"],
      where: { createdById: id },
      _count: { status: true },
    }),
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

  const workspaceMemberships = user.workspaceMembers
    .map((m) => {
      if (!m.workspace) return null;
      return {
        role: m.role as string,
        joinedAt: m.joinedAt,
        workspace: {
          id:   m.workspace.id,
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
          id:     m.project.id,
          name:   m.project.name,
          slug:   m.project.slug,
          status: m.project.status as string,
          workspace: {
            id:   m.project.workspace.id,
            name: m.project.workspace.name,
          },
        },
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return {
    id:                  user.id,
    name:                user.name  ?? "Unknown",
    email:               user.email,
    image:               user.image ?? null,
    role:                user.role,
    bio:                 user.bio   ?? null,
    timezone:            user.timezone ?? null,
    createdAt:           user.createdAt,
    lastLoginAt:         user.lastLoginAt         ?? null,
    lastProfileUpdateAt: user.lastProfileUpdateAt ?? null,
    ownedWorkspaces:     user.ownedWorkspaces,
    workspaceMemberships,
    projectMemberships,
    recentTasks:     user.createdTasks,
    featureRequests: user.FeatureRequest,
    taskStats: {
      total:      user._count.createdTasks,
      todo:       taskStatusMap["TODO"]        ?? 0,
      inProgress: taskStatusMap["IN_PROGRESS"] ?? 0,
      completed:  taskStatusMap["COMPLETED"]   ?? 0,
      cancelled:  taskStatusMap["CANCELLED"]   ?? 0,
    },
    storage: {
      usedMb:    Math.round((storageUsed._sum.size ?? 0) / (1024 * 1024)),
      fileCount: storageUsed._count.id,
    },
    _count: {
      ownedWorkspaces: user._count.ownedWorkspaces,
      workspaceMember: user._count.workspaceMembers,
      createdTasks:    user._count.createdTasks,
      assignedTasks:   user._count.assignedTasks,
      comments:        user._count.comments,
      focusSessions:   user._count.focusSessions,
      featureRequests: user._count.FeatureRequest,
      files:           user._count.files,
    },
  };
}

export async function queryProjects(
  params: AdminPaginationParams & { workspaceId?: string },
): Promise<PaginatedAdminResult<AdminProject>> {
  const { page, pageSize, skip } = paginate(params.page, params.pageSize);

  const where = {
    ...(params.workspaceId && { workspaceId: params.workspaceId }),
    ...(params.search && {
      OR: [
        { name: { contains: params.search, mode: "insensitive" as const } },
        { slug: { contains: params.search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true, name: true, slug: true, status: true,
        priority: true, createdAt: true, dueDate: true, completedAt: true,
        workspace: { select: { id: true, name: true, slug: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        members: {
          where: { role: "MANAGER" },
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

  // Task status breakdown — single query for all returned projects
  const projectIds = rows.map((r) => r.id);
  const taskBreakdown = await prisma.task.groupBy({
    by:    ["projectId", "status"],
    where: { projectId: { in: projectIds } },
    _count: { status: true },
  });

  const taskMap: Record<string, Record<string, number>> = {};
  taskBreakdown.forEach((t) => {
    if (!t.projectId) return;
    taskMap[t.projectId] ??= {};
    taskMap[t.projectId][t.status] = t._count.status;
  });

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
          dueDate:     r.dueDate      ?? null,
          completedAt: r.completedAt  ?? null,
          workspace:   r.workspace,
          createdBy:   { ...r.createdBy, name: r.createdBy.name ?? "Unknown" },
          manager:     r.members[0]
            ? { ...r.members[0].user, name: r.members[0].user.name ?? "Unknown" }
            : null,
          taskBreakdown: {
            total:      r._count.tasks,
            todo:       taskMap[r.id]?.["TODO"]        ?? 0,
            inProgress: taskMap[r.id]?.["IN_PROGRESS"] ?? 0,
            completed:  taskMap[r.id]?.["COMPLETED"]   ?? 0,
            cancelled:  taskMap[r.id]?.["CANCELLED"]   ?? 0,
          },
          _count: r._count,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    pagination: buildPagination(page, pageSize, totalCount),
  };
}

export async function queryBilling(
  params: AdminPaginationParams,
): Promise<PaginatedAdminResult<AdminBilling>> {
  const { page, pageSize, skip } = paginate(params.page, params.pageSize);

  const where = params.search
    ? {
        OR: [
          { workspace: { name:  { contains: params.search, mode: "insensitive" as const } } },
          { workspace: { owner: { email: { contains: params.search, mode: "insensitive" as const } } } },
        ],
      }
    : {};

  const [rows, totalCount] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
        owner: { ...r.workspace.owner, name: r.workspace.owner.name ?? "Unknown" },
      },
      recentInvoices: r.invoices,
    })),
    pagination: buildPagination(page, pageSize, totalCount),
  };
}

export async function queryActivity(
  params: AdminPaginationParams,
): Promise<PaginatedAdminResult<AdminActivity>> {
  const { page, pageSize, skip } = paginate(params.page, params.pageSize);

  const [rows, totalCount] = await Promise.all([
    prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
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
      user:      { ...r.user, name: r.user.name ?? "Unknown" },
      workspace: r.workspace ?? null,
    })),
    pagination: buildPagination(page, pageSize, totalCount),
  };
}

/** Lightweight workspace lookup used by service-layer guards. */
export async function queryWorkspaceForGuard(slug: string) {
  return prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true,
      plan: true, maxMembers: true, maxStorage: true,
      aiDailyCalls: true, aiMonthlyTokens: true, aiMaxOutputTokens: true,
      owner:  { select: { id: true, name: true, email: true } },
      _count: { select: { members: true } },
      deletedAt: true,
    },
  });
}

/** Lightweight user lookup used by service-layer guards. */
export async function queryUserForGuard(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, bannedAt: true },
  });
}