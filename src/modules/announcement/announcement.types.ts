// ─── Enums ────────────────────────────────────────────────────────────────────

export type AnnouncementVisibility = 'PUBLIC' | 'PRIVATE';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateAnnouncementInput {
  title:       string;
  content:     string;
  visibility:  AnnouncementVisibility;
  isPinned?:   boolean;
  targetIds?:  string[];   // userIds for PRIVATE visibility
  workspaceSlug: string;
  projectId?:   string | null;
  createdById: string;
}

export interface UpdateAnnouncementInput {
  title?:      string;
  content?:    string;
  isPinned?:   boolean;
}

export interface AnnouncementFilterParams {
  workspaceSlug:string;
  userId:       string;
  projectId?:   string | null;
  visibility?:  AnnouncementVisibility;
  isPinned?:    boolean;
  page?:        number;
  pageSize?:    number;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AnnouncementTarget {
  userId: string;
  user: {
    id:    string;
    name:  string;
    image: string | null;
  };
}

export interface AnnouncementResult {
  id:          string;
  title:       string;
  content:     string;
  visibility:  AnnouncementVisibility;
  isPinned:    boolean;
  createdAt:   Date;
  updatedAt:   Date;
  workspaceSlug: string;
  project:    {
    id:   string;
    name: string;
  }
  projectId:   string | null;
  createdById: string;
  createdBy: {
    id:    string;
    name:  string;
    image: string | null;
  };
  targets: AnnouncementTarget[];
}

export interface PaginatedAnnouncementsResult {
  data: AnnouncementResult[];
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
  canManage: boolean;
  reason?:   string;
}