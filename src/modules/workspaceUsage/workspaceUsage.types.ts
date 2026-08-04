export interface WorkspaceUsageData {
  snapshot: UsageSnapshot;
  projectActivity: ProjectActivityMetrics;
  userEngagement: UserEngagementMetrics;
  resourceUsage: ResourceUsageMetrics;
  workspaceLoad: WorkspaceLoadMetrics;
  workspaceGrowth: WorkspaceGrowthMetrics;
  featureUsage: FeatureUsageMetrics;
  planLimits: PlanLimitsMetrics;
  isAdmin: boolean;
}

export interface UsageSnapshot {
  totalMembers: number;
  activeMembers: number;
  totalTasks: number;
  totalProjects: number;
  storageUsedMB: number;
  activityEvents: number;
  avgDailyUsers: number;
  engagementScore: number;
}

export interface FeatureUsageMetrics {
  tasksCreated: number;
  commentsAdded: number;
  timeEntriesLogged: number;
  filesUploaded: number;
  mentionsUsed: number;
  notificationsTriggered: number;
}

export interface PlanLimitsMetrics {
  currentPlan: string;
  memberCount: number;
  memberLimit: number;
  storageUsedMB: number;
  storageLimitMB: number;
  projectCount: number;
  projectLimit: number;
  automationCount: number;
  automationLimit: number;
}

export interface ProjectActivityMetrics {
  mostActive: Array<{
    id: string;
    name: string;
    color: string | null;
    activityScore: number;
    taskCount: number;
    commentCount: number;
    lastActivity: Date;
  }>;
  lowActivity: Array<{
    id: string;
    name: string;
    color: string | null;
    taskCount: number;
    daysSinceLastActivity: number;
  }>;
  tasksPerProjectTrend: Array<{
    projectId: string;
    projectName: string;
    trend: Array<{ date: string; count: number }>;
  }>;
}

export interface UserEngagementMetrics {
  activeUsers: {
    online: number;
    thisWeek: number;
    thisMonth: number;
  };
  inactiveUsers: Array<{
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    lastActive: Date | null;
    daysSinceActive: number;
  }>;
  collaborationIndex: Array<{
    userId: string;
    userName: string | null;
    userEmail: string;
    userImage: string | null;
    commentsCount: number;
    tasksCreated: number;
    tasksAssigned: number;
    collaborationScore: number;
  }>;
  dailyActiveUsers: Array<{
    date: string;
    count: number;
  }>;
  /** Activity intensity (0-100) per weekday × hour bucket, from the Activity table. */
  peakHours: Array<{
    day: string;
    hour: number;
    activity: number;
  }>;
}

export interface ResourceUsageMetrics {
  storageByProject: Array<{
    projectId: string;
    projectName: string;
    storageUsedMB: number;
    fileCount: number;
    percentage: number;
  }>;
  filesByUser: Array<{
    userId: string;
    userName: string | null;
    userEmail: string;
    fileCount: number;
    storageUsedMB: number;
  }>;
  totalStorage: {
    usedMB: number;
    totalMB: number;
    percentage: number;
  };
  /** Monthly cumulative storage (MB) for the last 6 months, from file.uploadedAt. */
  storageGrowth: Array<{
    month: string;
    storage: number;
  }>;
  /** Files uploaded per month (last 6 months) — powers the file-count trend card. */
  fileTrend: Array<{
    month: string;
    count: number;
  }>;
  /** Month-over-month change of file uploads (%, null when there is no baseline). */
  fileGrowthPct: number | null;
  /** File count grouped by mime-type category (Images, PDFs, Docs, Videos, ...). */
  fileTypeDistribution: Array<{
    name: string;
    value: number;
  }>;
}

export interface WorkspaceLoadMetrics {
  tasksPerUser: Array<{
    userId: string;
    userName: string | null;
    userEmail: string;
    userImage: string | null;
    activeTasks: number;
    overdueTasks: number;
    capacityLevel: 'UNDERUTILIZED' | 'OPTIMAL' | 'NEAR_CAPACITY' | 'OVERLOADED';
  }>;
  projectsNearingDeadlines: Array<{
    projectId: string;
    projectName: string;
    dueDate: Date;
    daysRemaining: number;
    completionPercentage: number;
    status: string;
  }>;
  averageTaskCompletion: {
    byUser: Array<{
      userId: string;
      userName: string | null;
      completionRate: number;
      avgCompletionDays: number;
    }>;
    byProject: Array<{
      projectId: string;
      projectName: string;
      completionRate: number;
      avgCompletionDays: number;
    }>;
  };
}

export type GrowthInsightType = "positive" | "warning" | "neutral";

export interface GrowthInsight {
  id: number;
  text: string;
  type: GrowthInsightType;
}

export interface WorkspaceGrowthMetrics {
  thisMonth: {
    newUsers: number;
    newProjects: number;
    newTasks: number;
  };
  trend: Array<{
    month: string;
    users: number;
    projects: number;
    tasks: number;
  }>;
  projectLifecycle: {
    created: number;
    active: number;
    completed: number;
    archived: number;
  };
  /** Real month-over-month % change (null when there is no previous-month baseline). */
  changes: {
    newTasks: number | null;
    newUsers: number | null;
    newProjects: number | null;
  };
  /** Data-driven insights generated from the real growth + storage metrics. */
  insights: GrowthInsight[];
}

// Mirrors the authoritative billing limits in modules/billing/plans.config.ts
// (storage in MB): FREE = 1 GB, PRO = 10 GB, BUSINESS = 100 GB.
export const PLAN_LIMITS = {
  FREE: { members: 5, storage: 1024, projects: 3, automations: 10 },
  PRO: { members: 25, storage: 10240, projects: -1, automations: 50 },
  BUSINESS: { members: -1, storage: 102400, projects: -1, automations: 200 },
  ENTERPRISE: { members: -1, storage: -1, projects: -1, automations: -1 },
} as const;
