export const workspaceSelect = {
  id:      true,
  name:    true,
  ownerId: true,
  slug:    true,
} as const;

export const memberUserSelect = {
  id:    true,
  name:  true,
  email: true,
  image: true,
} as const;

export const taskAssigneeUserSelect = {
  id:    true,
  name:  true,
  email: true,
  image: true,
} as const;

const membersInclude = {
  include: {
    user: { select: memberUserSelect },
  },
  orderBy: { joinedAt: 'asc' as const },
} as const;

export const projectListInclude = {
  workspace: { select: workspaceSelect },
  members:   membersInclude,
  _count:    { select: { tasks: true } },
} as const;

export const projectDetailInclude = {
  workspace: { select: workspaceSelect },
  members:   membersInclude,
  tasks: {
    include: {
      assignees: {
        include: {
          user: { select: taskAssigneeUserSelect },
        },
      },
      recurrence: true,
  sprint: { select: { id: true, name: true } },
  milestone: { select: { id: true, title: true, status: true, progress: true } },
      _count: { select: { comments: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  _count: { select: { tasks: true, members: true, announcement: true } },
} as const;

export const projectWorkspaceListSelect = {
  id:          true,
  slug:        true,
  name:        true,
  color:       true,
  description: true,
  status:      true,
  priority:    true,
  dueDate:     true,
  _count:      { select: { tasks: true, members: true } },
} as const;

export const projectMemberInclude = {
  user: { select: memberUserSelect },
} as const;