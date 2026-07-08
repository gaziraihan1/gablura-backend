// project.mutation.ts
import { prisma }        from '../../lib/prisma.js';
import type {
  CreateProjectDto,
  UpdateProjectDto,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
} from './project.types.js';
import { BadRequestError, NotFoundError } from '../../errors/index.js';
import { projectListInclude, projectMemberInclude } from './project.selects.js';
import { ProjectAccess }   from './project.access.js';
import { SlugService }     from '../../services/slug.service.js';
import { ProjectStatus }   from '@prisma/client';
import { WorkspaceCache, AnalyticsCache, ProjectCache, AccessControlCache } from '../../lib/redis/cache.client.js';

export const ProjectMutation = {
  async createProject(data: CreateProjectDto) {
  await ProjectAccess.assertWorkspaceAccess(data.createdById, data.workspaceId);

  // Must fetch workspace FIRST so we can set both FK columns
  const workspace = await prisma.workspace.findUnique({
    where:  { id: data.workspaceId },
    select: { id: true, slug: true, name: true, ownerId: true },
  });
  if (!workspace) throw new NotFoundError('Workspace');

  const slug = await SlugService.generateProjectSlug(data.name, data.workspaceId);

  const project = await prisma.project.create({
    data: {
      name:        data.name,
      slug,
      description: data.description,
      color:       data.color    ?? '#667eea',
      icon:        data.icon,
      status:      data.status   ?? 'ACTIVE',
      priority:    data.priority ?? 'MEDIUM',
      startDate:   data.startDate,
      dueDate:     data.dueDate,
      // Use composite connect so BOTH workspaceId AND workspaceSlug are set
      workspace:   { connect: { id_slug: { id: workspace.id, slug: workspace.slug } } },
      createdBy:   { connect: { id: data.createdById } },
    },
    include: projectListInclude,
  });

  // Invalidate caches in a non-blocking way
  Promise.all([
    ProjectCache.invalidateWorkspaceProjects(data.workspaceId),
    ProjectCache.invalidateUserProjects(data.createdById),
    WorkspaceCache.invalidateWorkspace(data.workspaceId, workspace.slug),
    AnalyticsCache.invalidateWorkspace(data.workspaceId),
  ]).catch(() => {});

  return project;
},
  async updateProject(userId: string, projectId: string, data: UpdateProjectDto) {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    const updateData: any = { ...data };
    if (data.status === ProjectStatus.COMPLETED) updateData.completedAt = new Date();
    if (data.status && data.status !== ProjectStatus.COMPLETED) updateData.completedAt = null;

    // Fetch workspace info before updating
    const existing = await prisma.project.findUnique({
  where:  { id: projectId },
  select: {
    workspaceId: true,
    workspace: { select: { slug: true } },
    slug: true,
  },
});

    const project = await prisma.project.update({
      where:   { id: projectId },
      data:    updateData,
      include: projectListInclude,
    });

    if (existing?.workspaceId) {
  const workspaceId = existing.workspaceId as string;
  const slug = existing?.workspace?.slug || existing.slug;
  // Invalidate caches in a non-blocking way
  Promise.all([
    ProjectCache.invalidateProject(projectId, slug),
    ProjectCache.invalidateWorkspaceProjects(workspaceId),
    ProjectCache.invalidateUserProjects(userId),
    WorkspaceCache.invalidateWorkspace(workspaceId, slug),
    AnalyticsCache.invalidateWorkspace(workspaceId),
  ]).catch(() => {});
}

    return project;
  },

  async deleteProject(userId: string, projectId: string): Promise<void> {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    // Must fetch before delete — row won't exist after
    const project = await prisma.project.findUnique({
  where:  { id: projectId },
  select: {
    workspaceId: true,
    workspace: { select: { slug: true } },
    slug: true,
  },
});

await prisma.project.delete({ where: { id: projectId } });

  if (project?.workspaceId) {
    const workspaceId = project.workspaceId as string;
    const slug = project?.workspace?.slug || project.slug;
    // Invalidate caches in a non-blocking way
    Promise.all([
      ProjectCache.invalidateProject(projectId, slug),
      ProjectCache.invalidateWorkspaceProjects(workspaceId),
      ProjectCache.invalidateUserProjects(userId),
      WorkspaceCache.invalidateWorkspace(workspaceId, slug),
      AnalyticsCache.invalidateWorkspace(workspaceId),
      AccessControlCache.invalidateProjectUsers(projectId),
    ]).catch(() => {});
  }
  },

  // ── Member mutations — unchanged ──────────────────────────────────────────

  async addProjectMember(userId: string, projectId: string, data: AddProjectMemberDto) {
    const project = await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    const workspaceMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: project.workspaceId!, userId: data.userId },
    });
    if (!workspaceMember) throw new BadRequestError('User is not a member of this workspace');

    const existing = await prisma.projectMember.findFirst({
      where: { projectId, userId: data.userId },
    });
    if (existing) throw new BadRequestError('User is already a project member');

    const member = await prisma.projectMember.create({
      data:    { projectId, userId: data.userId, role: data.role ?? 'COLLABORATOR' },
      include: projectMemberInclude,
    });

    // Invalidate project cache (non-blocking)
    ProjectCache.invalidateProject(projectId).catch(() => {});
    AccessControlCache.invalidateProjectAccess(projectId, data.userId).catch(() => {});
    AccessControlCache.invalidateProjectUsers(projectId).catch(() => {});

    return member;
  },

  async updateProjectMemberRole(
    userId:    string,
    projectId: string,
    memberId:  string,
    data:      UpdateProjectMemberRoleDto,
  ) {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    const member = await prisma.projectMember.update({
      where:   { projectId_userId: { projectId, userId: memberId } },
      data:    { role: data.role },
      include: projectMemberInclude,
    });

    // Invalidate project cache (non-blocking)
    ProjectCache.invalidateProject(projectId).catch(() => {});
    AccessControlCache.invalidateProjectAccess(projectId, memberId).catch(() => {});
    AccessControlCache.invalidateProjectUsers(projectId).catch(() => {});

    return member;
  },

  async removeProjectMember(userId: string, projectId: string, memberId: string): Promise<void> {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    });

    // Invalidate project cache (non-blocking)
    ProjectCache.invalidateProject(projectId).catch(() => {});
    AccessControlCache.invalidateProjectAccess(projectId, memberId).catch(() => {});
    AccessControlCache.invalidateProjectUsers(projectId).catch(() => {});
  },
};