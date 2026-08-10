/**
 * src/tests/unit/templates/templates.mutation.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateMutation } from '../../../modules/templates/templates.mutation.js';
import { prisma } from '../../../lib/prisma.js';
import { SlugService } from '../../../services/slug.service.js';
import { resolveWorkspacePlan } from '../../../modules/task/task.quota.service.js';
import { PlanLimitError, ForbiddenError, NotFoundError, ValidationError } from '../../../errors/index.js';

const mockAssertWorkspaceMembership = vi.fn();
const mockAssertProjectEditAccess = vi.fn();
const mockAssertCanManageTemplate = vi.fn();

vi.mock('../../../modules/templates/templates.access.js', () => ({
  assertWorkspaceMembership: (...args: unknown[]) => mockAssertWorkspaceMembership(...args),
  assertProjectEditAccess: (...args: unknown[]) => mockAssertProjectEditAccess(...args),
  assertCanManageTemplate: (...args: unknown[]) => mockAssertCanManageTemplate(...args),
}));

vi.mock('../../../services/slug.service.js', () => ({
  SlugService: { generateProjectSlug: vi.fn() },
}));

vi.mock('../../../modules/task/task.quota.service.js', () => ({
  resolveWorkspacePlan: vi.fn(),
}));

vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  ProjectCache: {
    invalidateWorkspaceProjects: vi.fn().mockResolvedValue(undefined),
    invalidateUserProjects: vi.fn().mockResolvedValue(undefined),
  },
  WorkspaceCache: { invalidateWorkspace: vi.fn().mockResolvedValue(undefined) },
  AnalyticsCache: { invalidateWorkspace: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    projectTemplate: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    workspace: { findUnique: vi.fn(), findMany: vi.fn() },
    project: { count: vi.fn(), findUnique: vi.fn() },
    projectSection: { findMany: vi.fn() },
    taskLabel: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    projectMilestone: { findMany: vi.fn() },
    projectView: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const tx = {
  project: { create: vi.fn() },
  projectSection: { create: vi.fn() },
  label: { upsert: vi.fn() },
  task: { create: vi.fn() },
  projectMilestone: { create: vi.fn() },
  projectView: { create: vi.fn() },
  projectTemplate: { update: vi.fn() },
};

const templateRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'tpl1',
  slug: 'engineering-sprint',
  title: 'Agile Sprint Board',
  description: 'A sprint board',
  icon: '⚙️',
  color: '#3b82f6',
  tier: 'PRO',
  status: 'available',
  visibility: 'PUBLIC',
  content: {
    sections: [
      { name: 'Backlog', color: '#94a3b8', taskStatus: 'TODO', wipLimit: 20 },
      { name: 'Done', color: '#10b981', taskStatus: 'COMPLETED', wipLimit: null },
    ],
    labels: [{ name: 'Feature', color: '#3b82f6' }],
    tasks: [
      { title: 'Build auth', status: 'TODO', priority: 'HIGH', section: 'Backlog', label: 'Feature' },
    ],
    milestones: [{ title: 'Sprint End', dueWeek: 2 }],
    views: [{ name: 'Board', type: 'KANBAN' }],
  },
  ...overrides,
});

const req = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'USER' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertWorkspaceMembership.mockResolvedValue(undefined);
  mockAssertProjectEditAccess.mockResolvedValue({
    workspaceId: 'ws1',
    slug: 'proj-slug',
    name: 'My Project',
  });
  mockAssertCanManageTemplate.mockImplementation(() => undefined);
  vi.mocked(resolveWorkspacePlan).mockResolvedValue('PRO' as never);
  vi.mocked(SlugService.generateProjectSlug).mockResolvedValue('agile-sprint-board');
  vi.mocked(prisma.$transaction).mockImplementation(((cb: unknown) =>
    (cb as (txn: typeof tx) => unknown)(tx)) as never);
  tx.project.create.mockResolvedValue({ id: 'proj1' });
  tx.projectSection.create.mockResolvedValue({ id: 'sec1' });
  tx.label.upsert.mockResolvedValue({ id: 'lbl1' });
  tx.task.create.mockResolvedValue({ id: 'task1' });
  tx.projectMilestone.create.mockResolvedValue({ id: 'ms1' });
  tx.projectView.create.mockResolvedValue({ id: 'view1' });
  tx.projectTemplate.update.mockResolvedValue({});
});

describe('TemplateMutation.use', () => {
  it('throws NotFoundError when the template does not exist', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(null);

    await expect(
      TemplateMutation.use('u1', 'missing', { workspaceId: 'ws1' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for non-available templates', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      templateRow({ status: 'coming_soon' }) as never,
    );

    await expect(
      TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('blocks a template tier above the workspace plan', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(templateRow() as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws1', slug: 'acme' } as never);
    vi.mocked(resolveWorkspacePlan).mockResolvedValue('FREE' as never);

    await expect(
      TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' }),
    ).rejects.toThrow(PlanLimitError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows PRO templates on a PRO workspace', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(templateRow() as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws1', slug: 'acme' } as never);
    vi.mocked(prisma.project.count).mockResolvedValue(0);

    const result = await TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ projectSlug: 'agile-sprint-board', workspaceSlug: 'acme' });
  });

  it('enforces the FREE project quota before importing', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      templateRow({ tier: 'FREE' }) as never,
    );
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws1', slug: 'acme' } as never);
    vi.mocked(resolveWorkspacePlan).mockResolvedValue('FREE' as never);
    vi.mocked(prisma.project.count).mockResolvedValue(3); // FREE limit = 3

    await expect(
      TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' }),
    ).rejects.toThrow(PlanLimitError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-members', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(templateRow() as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws1', slug: 'acme' } as never);
    mockAssertWorkspaceMembership.mockRejectedValue(new ForbiddenError('Not a member'));

    await expect(
      TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('creates the full project snapshot atomically inside the transaction', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(templateRow() as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws1', slug: 'acme' } as never);
    vi.mocked(prisma.project.count).mockResolvedValue(1);

    await TemplateMutation.use('u1', 'engineering-sprint', { workspaceId: 'ws1' });

    expect(tx.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Agile Sprint Board',
          slug: 'agile-sprint-board',
          createdBy: { connect: { id: 'u1' } },
        }),
      }),
    );
    expect(tx.projectSection.create).toHaveBeenCalledTimes(2);
    expect(tx.label.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_name: { workspaceId: 'ws1', name: 'Feature' } },
      }),
    );
    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Build auth',
          sectionId: 'sec1',
          projectId: 'proj1',
          workspaceId: 'ws1',
          labels: { create: [{ labelId: 'lbl1' }] },
        }),
      }),
    );
    expect(tx.projectMilestone.create).toHaveBeenCalledTimes(1);
    expect(tx.projectView.create).toHaveBeenCalledTimes(1);
    expect(tx.projectTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl1' },
      data: { usageCount: { increment: 1 } },
    });
  });
});

describe('TemplateMutation.saveAsTemplate', () => {
  it('rejects users without project edit access', async () => {
    mockAssertProjectEditAccess.mockRejectedValue(new ForbiddenError('No access'));

    await expect(
      TemplateMutation.saveAsTemplate(req() as never, 'proj1', {}),
    ).rejects.toThrow(ForbiddenError);
  });

  it('snapshots the project into a PRIVATE template', async () => {
    const section = {
      id: 'sec1',
      name: 'Backlog',
      description: null,
      color: null,
      taskStatus: 'TODO',
      wipLimit: null,
    };
    vi.mocked(prisma.projectSection.findMany).mockResolvedValue([section] as never);
    vi.mocked(prisma.taskLabel.findMany).mockResolvedValue([
      { label: { name: 'Feature', color: '#3b82f6' } },
    ] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      {
        title: 'Task A',
        status: 'TODO',
        priority: 'HIGH',
        sectionId: 'sec1',
        labels: [{ label: { name: 'Feature' } }],
      },
    ] as never);
    vi.mocked(prisma.projectMilestone.findMany).mockResolvedValue([
      { title: 'M1', dueDate: new Date() },
    ] as never);
    vi.mocked(prisma.projectView.findMany).mockResolvedValue([
      { name: 'Board', type: 'KANBAN' },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Ada' } as never);
    vi.mocked(prisma.projectTemplate.create).mockResolvedValue({} as never);

    const result = await TemplateMutation.saveAsTemplate(req() as never, 'proj1', {
      title: 'My Template',
    });

    expect(result.title).toBe('My Template');
    expect(prisma.projectTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visibility: 'PRIVATE',
          workspaceId: 'ws1',
          sourceProjectId: 'proj1',
          authorId: 'u1',
          tier: 'PRO',
        }),
      }),
    );
  });

  it('queues PUBLIC save requests as PENDING for moderation', async () => {
    vi.mocked(prisma.projectSection.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.taskLabel.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.projectMilestone.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.projectView.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Ada' } as never);
    vi.mocked(prisma.projectTemplate.create).mockResolvedValue({} as never);

    const result = await TemplateMutation.saveAsTemplate(req() as never, 'proj1', {
      visibility: 'PUBLIC',
    });

    expect(result.visibility).toBe('PENDING');
    expect(prisma.projectTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'PENDING' }),
      }),
    );
  });
});

describe('TemplateMutation.approve / reject (moderation)', () => {
  it('approves a PENDING submission to PUBLIC', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'community-sprint',
      title: 'Community Sprint',
      visibility: 'PENDING',
    } as never);
    vi.mocked(prisma.projectTemplate.update).mockResolvedValue({
      slug: 'community-sprint',
      title: 'Community Sprint',
      visibility: 'PUBLIC',
    } as never);

    const result = await TemplateMutation.approve('community-sprint');

    expect(result.visibility).toBe('PUBLIC');
    expect(prisma.projectTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { visibility: 'PUBLIC' } }),
    );
  });

  it('rejects a submission back to PRIVATE', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'community-sprint',
      title: 'Community Sprint',
      visibility: 'PENDING',
    } as never);
    vi.mocked(prisma.projectTemplate.update).mockResolvedValue({
      slug: 'community-sprint',
      title: 'Community Sprint',
      visibility: 'PRIVATE',
    } as never);

    const result = await TemplateMutation.reject('community-sprint');
    expect(result.visibility).toBe('PRIVATE');
  });

  it('throws NotFoundError for missing templates', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(null);
    await expect(TemplateMutation.approve('nope')).rejects.toThrow(NotFoundError);
    await expect(TemplateMutation.reject('nope')).rejects.toThrow(NotFoundError);
  });

  it('refuses to approve a template that is still PRIVATE', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'private-draft',
      title: 'Draft',
      visibility: 'PRIVATE',
    } as never);

    await expect(TemplateMutation.approve('private-draft')).rejects.toThrow(ValidationError);
  });
});

describe('TemplateMutation.update / remove', () => {
  it('updates when the caller is the author', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'my-template',
      authorId: 'u1',
    } as never);
    vi.mocked(prisma.projectTemplate.update).mockResolvedValue({
      slug: 'my-template',
      title: 'Renamed',
    } as never);

    const result = await TemplateMutation.update(req() as never, 'my-template', {
      title: 'Renamed',
    });

    expect(result.title).toBe('Renamed');
    expect(mockAssertCanManageTemplate).toHaveBeenCalled();
  });

  it('rejects updates from non-authors', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'my-template',
      authorId: 'someone-else',
    } as never);
    mockAssertCanManageTemplate.mockImplementation(() => {
      throw new ForbiddenError('Only the template author can manage this template');
    });

    await expect(
      TemplateMutation.update(req() as never, 'my-template', { title: 'X' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('deletes when authorized', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      slug: 'my-template',
      authorId: 'u1',
    } as never);
    vi.mocked(prisma.projectTemplate.delete).mockResolvedValue({} as never);

    const result = await TemplateMutation.remove(req() as never, 'my-template');

    expect(result).toEqual({ success: true });
    expect(prisma.projectTemplate.delete).toHaveBeenCalledWith({ where: { slug: 'my-template' } });
  });
});
