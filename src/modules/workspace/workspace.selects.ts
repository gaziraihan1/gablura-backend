export const ownerSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export const memberUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export const workspaceListInclude = {
  owner: { select: ownerSelect },
  members: { include: { user: { select: memberUserSelect } } },
  _count: { select: { projects: true, members: true } },
} as const;

/**
 * Slim shape for the public workspace directory: workspace metadata + owner
 * name/avatar + counts, but NO member roster and no member emails, so a
 * browse-all endpoint never leaks private contact details.
 */
export const workspacePublicListInclude = {
  owner: { select: { id: true, name: true, image: true } },
  _count: { select: { projects: true, members: true } },
} as const;

export const workspaceDetailInclude = {
  owner: { select: ownerSelect },
  members: {
    include: { user: { select: memberUserSelect } },
    orderBy: { joinedAt: "asc" as const },
  },
  projects: {
    take: 10,
    orderBy: { updatedAt: "desc" as const },
    include: { _count: { select: { tasks: true } } },
  },
  _count: { select: { projects: true, members: true, labels: true } },
} as const;

export const invitationInclude = {
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logo: true,
      color: true,
    },
  },
} as const;
