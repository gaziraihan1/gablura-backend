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
import { ProjectStatus, TaskStatus } from '@prisma/client';
import { WorkspaceCache, AnalyticsCache, ProjectCache, AccessControlCache } from '../../lib/redis/cache.client.js';

// Default workflow seeded on every new project so the Kanban board is never empty.
// Mirrors the frontend's static COLUMNS (one TaskStatus per column).
const DEFAULT_SECTIONS = [
  { name: 'Backlog',     color: '#94a3b8', wipLimit: 20,  taskStatus: TaskStatus.TODO },
  { name: 'In Progress', color: '#3b82f6', wipLimit: 3,   taskStatus: TaskStatus.IN_PROGRESS },
  { name: 'Review',      color: '#a855f7', wipLimit: 5,   taskStatus: TaskStatus.IN_REVIEW },
  { name: 'Blocked',     color: '#ef4444', wipLimit: 999, taskStatus: TaskStatus.BLOCKED },
  { name: 'Done',        color: '#10b981', wipLimit: 999, taskStatus: TaskStatus.COMPLETED },
] as const;

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

  // Seed the default workflow so the board has columns out of the box
  await prisma.projectSection.createMany({
    data: DEFAULT_SECTIONS.map((section, index) => ({
      name:       section.name,
      color:      section.color,
      wipLimit:   section.wipLimit,
      taskStatus: section.taskStatus,
      position:   index,
      projectId:  project.id,
    })),
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
  const projectSlug = existing.slug;
  const workspaceSlug = existing?.workspace?.slug;
  // Invalidate caches BEFORE responding. If this were fire-and-forget, a
  // client refetch (triggered by the frontend's invalidateQueries right
  // after the PATCH resolves) could race the Redis DEL and be served the
  // stale cached list — reverting the just-updated status (e.g. ARCHIVED)
  // back to the old value until the TTL expires.
  // NOTE: ProjectCache.invalidateProject expects the PROJECT slug
  // (cache key `project:slug:<projectSlug>`); the workspace slug is used
  // only for WorkspaceCache invalidation.
  await Promise.all([
    ProjectCache.invalidateProject(projectId, projectSlug),
    ProjectCache.invalidateWorkspaceProjects(workspaceId),
    ProjectCache.invalidateUserProjects(userId),
    WorkspaceCache.invalidateWorkspace(workspaceId, workspaceSlug),
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
    const projectSlug = project.slug;
    const workspaceSlug = project?.workspace?.slug;
    // Invalidate caches in a non-blocking way.
    // NOTE: ProjectCache.invalidateProject expects the PROJECT slug
    // (cache key `project:slug:<projectSlug>`); the workspace slug is used
    // only for WorkspaceCache invalidation.
    Promise.all([
      ProjectCache.invalidateProject(projectId, projectSlug),
      ProjectCache.invalidateWorkspaceProjects(workspaceId),
      ProjectCache.invalidateUserProjects(userId),
      WorkspaceCache.invalidateWorkspace(workspaceId, workspaceSlug),
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

    // The workspace list and per-user lists embed the members array — refresh
    // them so the new collaborator shows up immediately on the projects page
    // (and their own list unlocks the card instead of showing the modal).
    ProjectCache.invalidateWorkspaceProjects(project.workspaceId!).catch(() => {});
    ProjectCache.invalidateUserProjects(data.userId).catch(() => {});
    ProjectCache.invalidateUserProjects(userId).catch(() => {});

    return member;
  },

  async updateProjectMemberRole(
    userId:    string,
    projectId: string,
    memberId:  string,
    data:      UpdateProjectMemberRoleDto,
  ) {
    const project = await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    const member = await prisma.projectMember.update({
      where:   { projectId_userId: { projectId, userId: memberId } },
      data:    { role: data.role },
      include: projectMemberInclude,
    });

    // Invalidate project cache (non-blocking)
    ProjectCache.invalidateProject(projectId).catch(() => {});
    AccessControlCache.invalidateProjectAccess(projectId, memberId).catch(() => {});
    AccessControlCache.invalidateProjectUsers(projectId).catch(() => {});

    if (project.workspace?.id) {
      ProjectCache.invalidateWorkspaceProjects(project.workspace.id).catch(() => {});
    }
    ProjectCache.invalidateUserProjects(memberId).catch(() => {});
    ProjectCache.invalidateUserProjects(userId).catch(() => {});

    return member;
  },

  async removeProjectMember(userId: string, projectId: string, memberId: string): Promise<void> {
    const project = await ProjectAccess.assertProjectAdminAccess(userId, projectId);

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    });

    // Invalidate project cache (non-blocking)
    ProjectCache.invalidateProject(projectId).catch(() => {});
    AccessControlCache.invalidateProjectAccess(projectId, memberId).catch(() => {});
    AccessControlCache.invalidateProjectUsers(projectId).catch(() => {});

    if (project.workspace?.id) {
      ProjectCache.invalidateWorkspaceProjects(project.workspace.id).catch(() => {});
    }
    ProjectCache.invalidateUserProjects(memberId).catch(() => {});
    ProjectCache.invalidateUserProjects(userId).catch(() => {});
  },
};