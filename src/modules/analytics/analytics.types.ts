
export interface ExecutiveKPIs {
  totalProjects: number;
  activeProjects: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRate: number;
  totalMembers: number;
  activeMembers: number;
  totalHours: number;
  storageUsed: number;
}

export interface TaskStatusDistribution {
  status: string;
  count: number;
  percentage: number;
}

export interface TrendDataPoint {
  date: Date;
  count: number;
}

export interface OverdueTrendPoint {
  weekStart: Date;
  count: number;
}

export interface ProjectHealth {
  projectId: string;
  projectName: string;
  status: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  dueDate: Date | null;
  health: 'healthy' | 'at-risk' | 'critical';
}

export interface MemberContribution {
  userId: string;
  userName: string | null;
  userEmail: string;
  userImage: string | null;
  role: string;
  completedTasks: number;
  totalHours: number;
  commentsCount: number;
  filesCount: number;
  contributionScore: number;
}

export interface TimeTrackingSummary {
  totalHours: number;
  avgHoursPerMember: number;
  projectBreakdown: Array<{
    projectId: string;
    projectName: string;
    hours: number;
  }>;
  memberBreakdown: Array<{
    userId: string;
    userName: string | null;
    userEmail: string;
    hours: number;
  }>;
}

export interface ActivityVolumePoint {
  date: Date;
  created: number;
  updated: number;
  completed: number;
  assigned: number;
  total: number;
}

export interface MostActiveDay {
  day: string;
  count: number;
  mostCommonAction: string;
}

export interface MemberWorkload {
  userId: string;
  userName: string | null;
  userEmail: string;
  assignedTasks: number;
  status: 'normal' | 'high' | 'overloaded';
}

export interface DeadlineRiskAnalysis {
  dueIn3Days: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    priority: string;
    assignedTo: string;
  }>;
  dueIn7DaysCount: number;
  highPriorityNearDeadline: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    priority: string;
  }>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ProjectAnalyticsKPIs {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  completionRate: number;
  totalMembers: number;
  totalHours: number;
  storageUsed: number;
}

export interface ProjectTaskStatusDistribution {
  status: string;
  count: number;
  percentage: number;
}

export interface ProjectTaskPriorityDistribution {
  priority: string;
  count: number;
  percentage: number;
}

export interface ProjectMemberContribution {
  userId: string;
  userName: string | null;
  userEmail: string;
  userImage: string | null;
  role: string;
  completedTasks: number;
  totalHours: number;
  commentsCount: number;
  contributionScore: number;
}

export interface ProjectTimeTrackingSummary {
  totalHours: number;
  avgHoursPerMember: number;
  topContributors: Array<{
    userId: string;
    userName: string | null;
    userEmail: string;
    hours: number;
  }>;
}

export interface ProjectCompletionTrend {
  date: Date;
  count: number;
}

export interface ProjectDeadlineRisk {
  dueIn3DaysCount: number;
  dueIn7DaysCount: number;
  highPriorityNearDeadline: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    priority: string;
  }>;
  riskLevel: 'low' | 'medium' | 'high';
}