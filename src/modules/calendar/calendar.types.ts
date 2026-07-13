
export type {
  CalendarDayAggregate,
  BurnoutSignal,
  GoalCheckpoint,
  SystemCalendarEvent,
  EnergyLevel,
  WellnessRecommendation,
  TimeEntryCategory,
  RecommendationType,
} from '@prisma/client';

export interface CalendarFilters {
  userId: string;
  workspaceId?: string;
  startDate: Date;
  endDate: Date;
}

export interface TimeAllocation {
  deepWork: number;
  meetings: number;
  admin: number;
  learning: number;
  other: number;
}

export interface CalendarInsights {
  totalPlannedHours: number;
  totalCapacityHours: number;
  commitmentGap: number;
  overloadedDays: number;
  focusDays: number;
  burnoutRisk: string;
  timeAllocation: TimeAllocation | null;
}

export interface BurnoutTrend {
  weekStart: string;
  riskLevel: string;
  consecutiveHeavyDays: number;
  avgDailyLoad: number;
}

export interface CreateGoalCheckpointInput {
  userId: string;
  workspaceId?: string;
  title: string;
  type: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'KPI';
  targetDate: Date;
}

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface UserCapacityData {
  weeklyHours: number;
  dailyCapacityHours: number;
  deepWorkHours: number;
}

export interface UserWorkScheduleData {
  workDays: string[];
  workStartHour: number;
  workEndHour: number;
  timezone?: string;
}