import { Prisma } from "@prisma/client";

export const userSelect = {
  id:    true,
  name:  true,
  image: true,
} as const;

export const commentFullInclude = {
  user: { select: userSelect },
  replies: {
    include: { user: { select: userSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

export const commentSimpleInclude = {
  user: { select: userSelect },
} as const;


export const taskForActivitySelect = {
  id:          true,
  title:       true,
  createdById: true,
  createdBy: {
    select: {
      id:            true,
      notifications: true,
    },
  },
  project: {
    select: {
      workspaceId: true,
      workspace: true,
    },
  },
  assignees: {
    select: {
      userId: true,
      user: {
        select: {
          notifications: true,
        },
      },
    },
  },
} satisfies Prisma.TaskSelect;