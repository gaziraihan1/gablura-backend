/**
 * modules/templates/templates.access.ts
 *
 * Access rules:
 *  - Catalog + detail are PUBLIC (templates page is a marketing page).
 *  - Importing into a workspace requires workspace membership.
 *  - Saving a project as a template requires project edit access.
 *  - Updating/deleting a template requires being its author or a Gablura admin.
 */
import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../../errors/index.js';
import { isGabluraAdmin } from '../../config/admin.config.js';
import type { AuthRequest } from '../../middleware/auth.js';

// Project members who can edit a project. Mirrors the ProjectRole enum
// (MANAGER | COLLABORATOR | VIEWER) and the frontend's canManage gate.
const PROJECT_EDITOR_ROLES = new Set(['MANAGER']);

/** Throws unless the user is a member (or owner) of the workspace. */
export async function assertWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerId: true,
      members: { where: { userId }, select: { id: true }, take: 1 },
    },
  });
  if (!workspace) throw new NotFoundError('Workspace not found');
  if (workspace.ownerId === userId) return;
  if (!workspace.members[0]) {
    throw new ForbiddenError('You are not a member of this workspace');
  }
}

/**
 * Throws unless the user can edit the project: creator, workspace owner,
 * workspace admin, or a project member with a MANAGER role.
 */
export async function assertProjectEditAccess(
  userId: string,
  projectId: string,
): Promise<{ workspaceId: string | null; slug: string; name: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      slug: true,
      workspaceId: true,
      createdById: true,
      workspace: {
        select: {
          ownerId: true,
          members: { where: { userId }, select: { role: true }, take: 1 },
        },
      },
      members: { where: { userId }, select: { role: true }, take: 1 },
    },
  });
  if (!project) throw new NotFoundError('Project not found');

  const isCreator = project.createdById === userId;
  const isWorkspaceOwner = project.workspace?.ownerId === userId;
  const isWorkspaceAdmin = project.workspace?.members[0]?.role === 'ADMIN';
  const role = project.members[0]?.role;
  const isEditor = role !== undefined && PROJECT_EDITOR_ROLES.has(role);

  if (!isCreator && !isWorkspaceOwner && !isWorkspaceAdmin && !isEditor) {
    throw new ForbiddenError('Only project editors can save a template');
  }

  return { workspaceId: project.workspaceId, slug: project.slug, name: project.name };
}

/** Throws unless the request user is the template author or a Gablura admin. */
export function assertCanManageTemplate(
  req: AuthRequest,
  template: { authorId: string | null },
): void {
  const userId = req.user?.id;
  if (!userId) throw new ForbiddenError('Authentication required');
  if (template.authorId && template.authorId === userId) return;
  if (req.user?.role === 'ADMIN' && isGabluraAdmin(userId)) return;
  throw new ForbiddenError('Only the template author can manage this template');
}
