
export type ActivityType =
  | 'CREATED'
  | 'UPDATED'
  | 'DELETED'
  | 'COMPLETED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'COMMENTED'
  | 'UPLOADED'
  | 'MOVED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED';

export type EntityType =
  | 'TASK'
  | 'PROJECT'
  | 'COMMENT'
  | 'FILE'
  | 'WORKSPACE'
  | 'MEMBER';

export interface ActivityFilters {
  workspaceId?: string;
  entityType?: EntityType;
  action?: ActivityType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export type WorkspaceActivityFilters = Pick<
  ActivityFilters,
  'action' | 'entityType' | 'limit' | 'offset'
>;

export type TaskActivityFilters = Pick<ActivityFilters, 'limit' | 'offset'>;

export interface ClearActivitiesFilters {
  workspaceId?: string;
  workspaceSlug?: string;   // ← added
  before?: Date;
}

export interface CreateActivityParams {
  action: ActivityType;
  entityType: EntityType;
  entityId: string;
  userId: string;
  workspaceId: string;
  workspaceSlug: string;   // ← added
  taskId?: string;
  metadata?: Record<string, any>;
}

export interface ActivityStats {
  total: number;
  today: number;
  byAction: Record<string, number>;
}

export interface PaginatedMeta {
  limit: number;
  offset: number;
  hasMore: boolean;
}