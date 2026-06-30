export type TaskStatus   = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskIntent   = 'EXECUTION' | 'PLANNING' | 'REVIEW' | 'LEARNING' | 'COMMUNICATION';
export type EnergyType   = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TaskFilterParams {
  userId:      string;
  type?:       string;
  workspaceId?: string;
  projectId?:  string;
  status?:     string;
  priority?:   string;
  labelIds?:   string[];
  assigneeId?: string;
  search?:     string;
}

export interface PaginationParams {
  page?:     number;
  pageSize?: number;
}

export interface SortParams {
  sortBy?:    'dueDate' | 'priority' | 'status' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateTaskInput {
  title:            string;
  description?:     string;
  projectId?:       string;
  status?:          string;
  priority?:        string;
  dueDate?:         Date;
  startDate?:       Date;
  estimatedHours?:  number;
  assigneeIds?:     string[];
  labelIds?:        string[];
  parentId?:        string;
  focusRequired?:   boolean;
  focusLevel?:      number;
  energyType?:      EnergyType;
  distractionCost?: number;
  intent?:          TaskIntent;
  createdById:      string;
}

export interface UpdateTaskInput {
  title?:            string;
  description?:      string;
  status?:           string;
  priority?:         string;
  dueDate?:          Date | null;
  startDate?:        Date | null;
  estimatedHours?:   number;
  assigneeIds?:      string[];
  labelIds?:         string[];
  focusRequired?:    boolean;
  focusLevel?:       number;
  energyType?:       EnergyType | null;
  distractionCost?:  number;
  intent?:           TaskIntent;
}

export interface TimeTracking {
  hoursSinceCreation: number;
  hoursUntilDue:      number | null;
  isOverdue:          boolean;
  isDueToday:         boolean;
  timeProgress:       number | null;
}

export interface TaskStats {
  personal:   number;
  assigned:   number;
  created:    number;
  overdue:    number;
  dueToday:   number;
  totalTasks: number;
  inProgress: number;
  completed:  number;
  byStatus:   Record<string, number>;
}

export interface PaginatedTasksResult<T = any> {
  data: T[];
  pagination: {
    page:       number;
    pageSize:   number;
    totalCount: number;
    totalPages: number;
    hasNext:    boolean;
    hasPrev:    boolean;
  };
}

export interface EditPermissionResult {
  canEdit: boolean;
  reason?: string;
}

export interface TaskForPermission {
  id:          string;
  createdById: string;
  projectId:   string | null;
  project?: {
    members: Array<{ role: string }>;
    workspace?: {
      members: Array<{ role: string }>;
    };
  } | null;
}

export interface TaskForTimeTracking {
  id?:             string;
  title?:           string
  createdAt:       Date;
  dueDate:         Date | null;
  status:          string;
  estimatedHours?: number | null;
  actualHours?:    number | null;
}