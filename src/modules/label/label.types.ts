// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateLabelDto {
  name:         string;
  color:        string;
  description?: string;
  workspaceId?: string;
  createdById:  string;
}

export interface UpdateLabelDto {
  name?:        string;
  color?:       string;
  description?: string | null;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page?:  number;
  limit?: number;
}

export interface PaginationMeta {
  page:        number;
  limit:       number;
  total:       number;
  totalPages:  number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
  data:       T[];
  pagination: PaginationMeta;
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface LabelFilters extends PaginationParams {
  workspaceId?: string;
}

export interface PopularLabelsFilters extends PaginationParams {
  workspaceId?: string;
  limit?: number;
}

export interface LabelTasksFilters extends PaginationParams {
  status?:   'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
  priority?: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
}