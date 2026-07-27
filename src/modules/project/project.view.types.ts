export type ProjectViewType = 'KANBAN' | 'LIST' | 'CALENDAR' | 'TIMELINE';
export type ViewVisibility = 'PRIVATE' | 'SHARED';

export interface CreateProjectViewDto {
  name:        string;
  description?: string;
  type?:        ProjectViewType;
  filters?:     Record<string, unknown>;
  sort?:        Record<string, unknown>;
  config?:      Record<string, unknown>;
  isDefault?:   boolean;
  visibility?:  ViewVisibility;
  projectId:    string;
  createdById:  string;
}

export interface UpdateProjectViewDto {
  name?:        string;
  description?: string;
  type?:        ProjectViewType;
  filters?:     Record<string, unknown>;
  sort?:        Record<string, unknown>;
  config?:      Record<string, unknown>;
  isDefault?:   boolean;
  visibility?:  ViewVisibility;
}
