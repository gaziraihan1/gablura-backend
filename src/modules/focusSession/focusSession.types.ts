import { FocusType } from '@prisma/client';

export type { FocusType } from '@prisma/client';

export const FocusSessionError = {
  USER_HAS_ACTIVE_SESSION:   'USER_HAS_ACTIVE_SESSION',
  SESSION_NOT_FOUND:         'SESSION_NOT_FOUND',
  SESSION_ALREADY_COMPLETED: 'SESSION_ALREADY_COMPLETED',
} as const;

export type FocusSessionErrorCode = typeof FocusSessionError[keyof typeof FocusSessionError];

export interface CreateFocusSessionInput {
  userId: string;
  taskId?: string;
  type: FocusType;
  duration: number;
}

export interface CompleteFocusSessionInput {
  sessionId: string;
  userId: string;
}

export interface CancelFocusSessionInput {
  sessionId: string;
  userId: string;
}

export interface GetFocusHistoryInput {
  userId: string;
  limit?: number;
}

export interface GetFocusStatsInput {
  userId: string;
  startDate?: Date;
  endDate?: Date;
}

export interface FocusStats {
  totalSessions: number;
  totalMinutes: number;
  completedToday: number;
  averageSessionLength: number;
}

export interface FocusStatsWithStreak extends FocusStats {
  focusStreak: number;
}

export interface FocusSessionTypeSummary {
  type: FocusType;
  sessions: number;
  minutes: number;
}

export interface FocusDailySummary {
  date: string;
  totalSessions: number;
  totalMinutes: number;
  byType: FocusSessionTypeSummary[];
}