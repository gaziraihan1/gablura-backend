export const createdBySelect = {
  id:    true,
  name:  true,
  email: true,
  image: true,
} as const;

export const assigneeUserSelect = {
  id:    true,
  name:  true,
  email: true,
  image: true,
} as const;

export const workspaceSelect = {
  id:   true,
  name: true,
} as const;

export const projectSlimSelect = {
  id:    true,
  name:  true,
  color: true,
  workspace: { select: workspaceSelect },
} as const;

export const projectWithWorkspaceIdSelect = {
  id:          true,
  slug:        true,
  name:        true,
  color:       true,
  status:      true,
  workspaceId: true,
  workspace:   { select: { id: true, name: true, slug: true } },
} as const;

export const taskFullInclude = {
  createdBy: { select: createdBySelect },
  editedBy: { select: createdBySelect },
  assignees: {
    include: {
      user: { select: assigneeUserSelect },
    },
  },
  labels: { include: { label: true } },
  project: { select: projectWithWorkspaceIdSelect },
  sprint: { select: { id: true, name: true } },
  milestone: { select: { id: true, title: true, status: true, progress: true } },
  recurrence: true,
  _count: {
    select: {
      comments: true,
      subtasks: true,
      files:    true,
    },
  },
} as const;

export const taskDetailInclude = {
  createdBy: { select: createdBySelect },
  editedBy: { select: createdBySelect },
  assignees: {
    include: {
      user: { select: assigneeUserSelect },
    },
  },
  labels: { include: { label: true } },
  project: { select: projectWithWorkspaceIdSelect },
  sprint: { select: { id: true, name: true } },
  milestone: { select: { id: true, title: true, status: true, progress: true } },
  recurrence: true,
  comments: {
    include: {
      user: { select: createdBySelect },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  subtasks: {
    include: {
      assignees: {
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
  },
  files: {
    include: {
      uploadedBy: { select: { id: true, name: true, image: true } },
    },
  },
} as const;

export const taskPermissionInclude = {
  project: {
    include: {
      workspace: {
        select: {                          // ✅ switch to select so ownerId is explicit
          ownerId: true,
          members: {
            select: { role: true, userId: true },
          },
        },
      },
      members: {
        select: { role: true, userId: true },
      },
    },
  },
} as const;

export const taskMinimalSelect = {
  id:          true,
  workspaceId: true,
  dueDate:     true,
} as const;

export const taskWithAssigneesInclude = {
  project: {
    select: { workspaceId: true },
  },
  assignees: {
    select: { userId: true },
  },
} as const;