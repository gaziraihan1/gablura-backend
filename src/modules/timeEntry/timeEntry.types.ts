export type TimeEntryCategory =
  | 'DEEP_WORK'
  | 'MEETINGS'
  | 'ADMIN'
  | 'LEARNING'
  | 'BREAK'
  | 'OTHER';

export interface CreateTimeEntryDto {
  taskId: string;
  userId: string;
  duration: number; // minutes
  category?: TimeEntryCategory;
  billable?: boolean;
  description?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
}

export interface UpdateTimeEntryDto {
  duration?: number; // minutes
  category?: TimeEntryCategory;
  billable?: boolean;
  description?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
}

export interface MyTimeEntriesFilters {
  from?: Date;
  to?: Date;
  /** Optional member filter for the workspace time log (OWNER/ADMIN only). */
  memberUserId?: string;
}
