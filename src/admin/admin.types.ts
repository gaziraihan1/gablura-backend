export interface AdminStats {
  totals: {
    users: number;
    workspaces: number;
    projects: number;
    tasks: number;
    announcements: number;
    meetings: number;
  };
  plans: { plan: string; count: number }[];
  featureRequests: {
    pending: number;
    approved: number;
    planned: number;
    completed: number;
    rejected: number;
  };
  /** Monthly platform growth — last 7 months, zero-filled. */
  growth: {
    label: string;
    users: number;
    workspaces: number;
    projects: number;
  }[];
  /** Per-day task counts by status — last 7 days. */
  taskActivity: {
    label: string;
    todo: number;
    inProgress: number;
    completed: number;
  }[];
  /** Workspaces created per month broken down by plan — last 7 months. */
  growthByPlan: {
    label: string;
    FREE: number;
    PRO: number;
    BUSINESS: number;
    ENTERPRISE: number;
  }[];
  totalStorageUsedMb: number;
  recentSignups: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt: Date;
  }[];
  recentWorkspaces: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    createdAt: Date;
    owner: { id: string; name: string; email: string };
    _count: { members: number; projects: number };
  }[];
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: Date;
  maxMembers: number;
  maxStorageMb: number;
  usedStorageMb: number;
  owner: { id: string; name: string; email: string; image: string | null };
  subscription: {
    status: string;
    billingCycle: string;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    planName: string;
    monthlyPriceCents: number;
  } | null;
  _count: { members: number; projects: number; tasks: number };
}

export interface AdminWorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  maxMembers: number;
  maxStorageMb: number;
  /** Focura-admin AI overrides — null means the plan default applies. */
  aiDailyCalls: number | null;
  aiMonthlyTokens: number | null;
  aiMaxOutputTokens: number | null;
  usedStorageMb: number;
  owner: { id: string; name: string; email: string; image: string | null };
  subscription: {
    id: string;
    status: string;
    billingCycle: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    stripeCustomerId: string;
    plan: {
      id: string;
      name: string;
      displayName: string;
      monthlyPriceCents: number;
      yearlyPriceCents: number;
      maxMembersPerWs: number;
      maxStorageMb: number;
      maxProjects: number;
      maxMeetingsPerMo: number;
      analyticsAccess: boolean;
      prioritySupport: boolean;
      apiAccess: boolean;
    };
    invoices: {
      id: string;
      stripeInvoiceId: string;
      amountPaid: number;
      currency: string;
      status: string;
      paidAt: Date | null;
      invoicePdf: string | null;
      periodStart: Date | null;
      periodEnd: Date | null;
    }[];
  } | null;
  members: {
    id: string;
    role: string;
    joinedAt: Date;
    user: { id: string; name: string; email: string; image: string | null };
  }[];
  projects: {
    id: string;
    name: string;
    slug: string;
    status: string;
    priority: string;
    createdAt: Date;
    createdBy: { id: string; name: string };
    _count: { tasks: number; members: number };
  }[];
  _count: {
    members: number;
    projects: number;
    tasks: number;
    meetings: number;
    announcements: number;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  _count: {
    ownedWorkspaces: number;
    workspaceMember: number;
    createdTasks: number;
    comments: number;
    focusSessions: number;
    featureRequests: number;
  };
}
export type WorkspacePlan = "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE"

export interface AdminUserDetail {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  bio: string | null;
  timezone: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastProfileUpdateAt: Date | null;
  ownedWorkspaces: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    _count: { members: number; projects: number };
  }[];
  workspaceMemberships: {
    role: string;
    joinedAt: Date;
    workspace: { id: string; name: string; slug: string; plan: string };
  }[];
  projectMemberships: {
    role: string;
    joinedAt: Date;
    project: {
      id: string;
      name: string;
      slug: string;
      status: string;
      workspace: { id: string; name: string };
    };
  }[];
  recentTasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: Date;
    project: { id: string; name: string } | null;
    workspace: { id: string; name: string } | null;
  }[];
  featureRequests: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
  }[];
  taskStats: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  storage: { usedMb: number; fileCount: number };
  _count: {
    ownedWorkspaces: number;
    workspaceMember: number;
    createdTasks: number;
    assignedTasks: number;
    comments: number;
    focusSessions: number;
    featureRequests: number;
    files: number;
  };
}

export interface AdminProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  priority: string;
  createdAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  workspace: { id: string; name: string; slug: string };
  createdBy: { id: string; name: string; email: string };
  manager: { id: string; name: string; email: string } | null;
  taskBreakdown: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  _count: { tasks: number; members: number; files: number };
}

export interface AdminBilling {
  subscriptionId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  plan: {
    id: string;
    name: string;
    displayName: string;
    monthlyPriceCents: number;
    yearlyPriceCents: number;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    owner: { id: string; name: string; email: string };
  };
  recentInvoices: {
    id: string;
    amountPaid: number;
    amountRefunded: number;
    refundedAt: Date | null;
    currency: string;
    status: string;
    paidAt: Date | null;
    invoicePdf: string | null;
  }[];
}

export interface AdminActivity {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  metadata: any;
  user: { id: string; name: string; email: string; image: string | null };
  workspace: { id: string; name: string; slug: string } | null;
}

export interface AdminPaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PaginatedAdminResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface BanUserInput {
  reason: string;
}

export interface DeleteWorkspaceInput {
  reason?:   string;
  hardDelete: boolean;
}

export interface AdminActionResult {
  success: boolean;
  message: string;
}