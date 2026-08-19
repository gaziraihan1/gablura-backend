export type ProjectStatus   = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type ProjectPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ProjectRole     = 'MANAGER' | 'COLLABORATOR' | 'VIEWER';

export interface CreateProjectDto {
  name:         string;
  description?: string;
  color?:       string;
  icon?:        string;
  status?:      ProjectStatus;
  priority?:    ProjectPriority;
  startDate?:   Date;
  dueDate?:     Date;
  workspaceId:  string;
  createdById:  string;
}

export interface UpdateProjectDto {
  name?:        string;
  description?: string;
  color?:       string;
  icon?:        string;
  status?:      ProjectStatus;
  priority?:    ProjectPriority;
  startDate?:   Date;
  dueDate?:     Date;
}

export interface AddProjectMemberDto {
  userId: string;
  role?:  ProjectRole;
}

export interface UpdateProjectMemberRoleDto {
  role: ProjectRole;
}

export interface TopPerformer {
  id:    string;
  name:  string | null;
  email: string;
  image: string | null;
}

export interface ProjectStats {
  totalTasks:      number;
  completedTasks:  number;
  inProgressTasks: number;
  overdueTasks:    number;
  totalMembers:    number;
  projectDays:     number;
  topPerformer:    TopPerformer | null;
}

export interface ProjectForStats {
  startDate: Date | null;
  createdAt: Date;
  _count:    { tasks: number; members: number };
  tasks: Array<{
    status:    string;
    dueDate:   Date | null;
    assignees: Array<{
      user: { id: string; name: string | null; email: string; image: string | null };
    }>;
  }>;
  members: Array<{
    userId: string;
    user:   { id: string; name: string | null; email: string; image: string | null };
  }>;
}

export interface ProjectForPermission {
  id:        string;
  workspace: {
    id:      string;
    ownerId: string;
  } | null;
}