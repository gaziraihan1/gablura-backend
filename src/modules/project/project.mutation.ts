// project.mutation.ts
import { prisma }        from '../../lib/prisma.js';
import type {
  CreateProjectDto,
  UpdateProjectDto,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
} from './project.types.js';
import { BadRequestError } from '../../errors/index.js';
import { projectListInclude, projectMemberInclude } from './project.selects.js';
import { ProjectAccess }   from './project.access.js';
import { SlugService }     from '../../services/slug.service.js';
import { ProjectStatus }   from '@prisma/client';
import { WorkspaceCache, AnalyticsCache } from '../../lib/redis/cache.client.js';

export const ProjectMutation = {
  async createProject(data: CreateProjectDto) {
    await ProjectAccess.assertWorkspaceAccess(data.createdById, data.workspaceId);
    const slug = await SlugService.generateProjectSlug(data.name, data.workspaceId);

    const [project, workspace] = await Promise.all([
      prisma.project.create({
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
          workspace:   { connect: { id: data.workspaceId } },
          createdBy:   { connect: { id: data.createdById } },
        },
        include: projectListInclude,
      }),
      prisma.workspace.findUnique({
        where:  { id: data.workspaceId },
        select: { slug: true },
      }),
    ]);

    WorkspaceCache.invalidateWorkspace(data.workspaceId, workspace?.slug).catch(() => {});
    AnalyticsCache.invalidateWorkspace(data.workspaceId).catch(() => {});

    return project;
  },

  async updateProject(userId: string, projectId: string, data: UpdateProjectDto) {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    const updateData: any = { ...data };
    if (data.status === ProjectStatus.COMPLETED) updateData.completedAt = new Date();
    if (data.status && data.status !== ProjectStatus.COMPLETED) updateData.completedAt = null;

    // Fetch workspace slug before updating (workspaceId won't change)
    const existing = await prisma.project.findUnique({
  where:  { id: projectId },
  select: { 
    workspaceId: true, 
    workspace: { select: { slug: true } } 
  },
});

    const project = await prisma.project.update({
      where:   { id: projectId },
      data:    updateData,
      include: projectListInclude,
    });

    if (existing?.workspaceId && existing?.workspace?.slug) {
  const workspaceId = existing.workspaceId as string;
  const slug = existing.workspace.slug as string;
  WorkspaceCache.invalidateWorkspace(workspaceId, slug).catch(() => {});
  AnalyticsCache.invalidateWorkspace(workspaceId).catch(() => {});
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
    workspace: { select: { slug: true } } 
  },
});

await prisma.project.delete({ where: { id: projectId } });

if (project?.workspaceId && project?.workspace?.slug) {
  const workspaceId = project.workspaceId as string;
  const slug = project.workspace.slug as string;
  WorkspaceCache.invalidateWorkspace(workspaceId, slug).catch(() => {});
  AnalyticsCache.invalidateWorkspace(workspaceId).catch(() => {});
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

    return prisma.projectMember.create({
      data:    { projectId, userId: data.userId, role: data.role ?? 'COLLABORATOR' },
      include: projectMemberInclude,
    });
  },

  async updateProjectMemberRole(
    userId:    string,
    projectId: string,
    memberId:  string,
    data:      UpdateProjectMemberRoleDto,
  ) {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    return prisma.projectMember.update({
      where:   { projectId_userId: { projectId, userId: memberId } },
      data:    { role: data.role },
      include: projectMemberInclude,
    });
  },

  async removeProjectMember(userId: string, projectId: string, memberId: string): Promise<void> {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    });
  },
};