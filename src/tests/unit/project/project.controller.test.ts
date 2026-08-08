// src/tests/unit/project/project.controller.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for project controller functions — Express req/res are mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {},
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: vi.fn().mockImplementation(() => ({})),
  CACHE_KEYS: {},
  CACHE_TTL: {},
}));

vi.mock('../../../queue/index.js', () => ({
  jobQueue: { add: vi.fn() },
}));

vi.mock('../../../services/slug.service.js', () => ({
  generateSlug: vi.fn().mockReturnValue('test-slug'),
}));

vi.mock('../../../lib/sentry.js', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setUserContext: vi.fn(),
}));

vi.mock('../../../errors/index.js', async () => {
  const actual = await vi.importActual('../../../errors/index.js');
  return actual;
});

vi.mock('../../../modules/project/project.access.js', () => ({
  ProjectAccess: {
    assertProjectAccess: vi.fn().mockResolvedValue({ id: 'p1' }),
    assertProjectAdminAccess: vi.fn().mockResolvedValue({ id: 'p1' }),
    assertProjectNotArchived: vi.fn().mockResolvedValue(undefined),
    isProjectAdmin: vi.fn().mockResolvedValue(false),
  },
}));
import { ProjectAccess } from '../../../modules/project/project.access.js';

// ── Project modules ──────────────────────────────────────────────────────────

vi.mock('../../../modules/project/project.query.js', () => ({
  ProjectQuery: {
    getUserProjects: vi.fn(),
    getProjectDetails: vi.fn(),
    getProjectBySlug: vi.fn(),
    getProjectsByWorkspace: vi.fn(),
  },
}));
import { ProjectQuery } from '../../../modules/project/project.query.js';

vi.mock('../../../modules/project/project.mutation.js', () => ({
  ProjectMutation: {
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    addProjectMember: vi.fn(),
    updateProjectMemberRole: vi.fn(),
    removeProjectMember: vi.fn(),
  },
}));
import { ProjectMutation } from '../../../modules/project/project.mutation.js';

vi.mock('../../../modules/project/project.sprint.query.js', () => ({
  SprintQuery: {
    getSprintStats: vi.fn(),
    getActiveSprint: vi.fn(),
    getById: vi.fn(),
  },
}));
import { SprintQuery } from '../../../modules/project/project.sprint.query.js';

vi.mock('../../../modules/project/project.sprint.mutation.js', () => ({
  SprintMutation: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    complete: vi.fn(),
  },
}));
import { SprintMutation } from '../../../modules/project/project.sprint.mutation.js';

vi.mock('../../../modules/project/project.section.query.js', () => ({
  SectionQuery: {
    getByProject: vi.fn(),
  },
}));
import { SectionQuery } from '../../../modules/project/project.section.query.js';

vi.mock('../../../modules/project/project.section.mutation.js', () => ({
  SectionMutation: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  },
}));
import { SectionMutation } from '../../../modules/project/project.section.mutation.js';

vi.mock('../../../modules/project/project.milestone.query.js', () => ({
  MilestoneQuery: {
    getMilestoneStats: vi.fn(),
    getById: vi.fn(),
  },
}));
import { MilestoneQuery } from '../../../modules/project/project.milestone.query.js';

vi.mock('../../../modules/project/project.milestone.mutation.js', () => ({
  MilestoneMutation: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateProgress: vi.fn(),
  },
}));
import { MilestoneMutation } from '../../../modules/project/project.milestone.mutation.js';

vi.mock('../../../modules/project/project.view.query.js', () => ({
  ProjectViewQuery: {
    getByProject: vi.fn(),
  },
}));
import { ProjectViewQuery } from '../../../modules/project/project.view.query.js';

vi.mock('../../../modules/project/project.view.mutation.js', () => ({
  ProjectViewMutation: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
import { ProjectViewMutation } from '../../../modules/project/project.view.mutation.js';

vi.mock('../../../modules/project/project.favorite.query.js', () => ({
  FavoriteQuery: {
    getByUser: vi.fn(),
    isFavorited: vi.fn(),
  },
}));
import { FavoriteQuery } from '../../../modules/project/project.favorite.query.js';

vi.mock('../../../modules/project/project.favorite.mutation.js', () => ({
  FavoriteMutation: {
    toggle: vi.fn(),
    update: vi.fn(),
  },
}));
import { FavoriteMutation } from '../../../modules/project/project.favorite.mutation.js';

// ── Validators (pass-through so zod schema.safeParse works) ──────────────────

vi.mock('../../../modules/project/project.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.validators.js');
  return actual;
});
vi.mock('../../../modules/project/project.section.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.section.validators.js');
  return actual;
});
vi.mock('../../../modules/project/project.sprint.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.sprint.validators.js');
  return actual;
});
vi.mock('../../../modules/project/project.milestone.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.milestone.validators.js');
  return actual;
});
vi.mock('../../../modules/project/project.view.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.view.validators.js');
  return actual;
});
vi.mock('../../../modules/project/project.favorite.validators.js', async () => {
  const actual = await vi.importActual('../../../modules/project/project.favorite.validators.js');
  return actual;
});

// ── Import controller under test ─────────────────────────────────────────────

import {
  getUserProjects,
  getProjectDetails,
  getProjectBySlug,
  getProjectsByWorkspace,
  createProject,
  updateProject,
  deleteProject,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  getProjectSections,
  createProjectSection,
  updateProjectSection,
  deleteProjectSection,
  reorderProjectSections,
  getProjectSprints,
  getActiveSprint,
  getSprintById,
  createSprint,
  updateSprint,
  deleteSprint,
  completeSprint,
  getProjectMilestones,
  getMilestoneById,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  updateMilestoneProgress,
  getProjectViews,
  createProjectView,
  updateProjectView,
  deleteProjectView,
  getUserFavorites,
  checkFavorite,
  toggleFavorite,
  updateFavorite,
} from '../../../modules/project/project.controller.js';

// ── Express types ─────────────────────────────────────────────────────────────

import type { Response } from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockRequest(
  params: any = {},
  body: any = {},
  user: any = { id: 'user1', email: 'test@example.com', role: 'MEMBER' },
): AuthRequest {
  return { params, body, user } as any;
}

function mockResponse(): any {
  const res: any = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

// ─────────────────────────────────────────────────────────────────────────────

// ── getUserProjects ──────────────────────────────────────────────────────────

describe('getUserProjects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns user projects successfully', async () => {
    const projects = [{ id: 'p1', name: 'Project A' }];
    (ProjectQuery.getUserProjects as any).mockResolvedValue(projects);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserProjects(req, res, next);

    expect(ProjectQuery.getUserProjects).toHaveBeenCalledWith('user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: projects });
  });

  it('returns empty array when user has no projects', async () => {
    (ProjectQuery.getUserProjects as any).mockResolvedValue([]);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserProjects(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('forwards error to next', async () => {
    const error = new Error('DB error');
    (ProjectQuery.getUserProjects as any).mockRejectedValue(error);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserProjects(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectDetails ────────────────────────────────────────────────────────

describe('getProjectDetails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns project details successfully', async () => {
    const project = { id: 'p1', name: 'Project A' };
    (ProjectQuery.getProjectDetails as any).mockResolvedValue(project);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectDetails(req, res, next);

    expect(ProjectQuery.getProjectDetails).toHaveBeenCalledWith('user1', 'p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
  });

  it('forwards error when project not found', async () => {
    const error = new Error('Not found');
    (ProjectQuery.getProjectDetails as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectDetails(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectBySlug ─────────────────────────────────────────────────────────

describe('getProjectBySlug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns project by slug successfully', async () => {
    const project = { id: 'p1', name: 'Project A', slug: 'project-a' };
    (ProjectQuery.getProjectBySlug as any).mockResolvedValue(project);

    const req = mockRequest({ slug: 'project-a' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectBySlug(req, res, next);

    expect(ProjectQuery.getProjectBySlug).toHaveBeenCalledWith('user1', 'project-a');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: project });
  });

  it('forwards error when slug not found', async () => {
    const error = new Error('Not found');
    (ProjectQuery.getProjectBySlug as any).mockRejectedValue(error);

    const req = mockRequest({ slug: 'unknown-slug' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectBySlug(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectsByWorkspace ───────────────────────────────────────────────────

describe('getProjectsByWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns projects for a workspace', async () => {
    const projects = [{ id: 'p1', name: 'Project A' }];
    (ProjectQuery.getProjectsByWorkspace as any).mockResolvedValue(projects);

    const req = mockRequest({ workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectsByWorkspace(req, res, next);

    expect(ProjectQuery.getProjectsByWorkspace).toHaveBeenCalledWith('user1', 'ws1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: projects });
  });

  it('returns empty array when workspace has no projects', async () => {
    (ProjectQuery.getProjectsByWorkspace as any).mockResolvedValue([]);

    const req = mockRequest({ workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectsByWorkspace(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

// ── createProject ────────────────────────────────────────────────────────────

describe('createProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates project successfully with valid data', async () => {
    const project = { id: 'p1', name: 'New Project' };
    (ProjectMutation.createProject as any).mockResolvedValue(project);

    const req = mockRequest({}, { name: 'New Project', workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(ProjectMutation.createProject).toHaveBeenCalledWith({
      name: 'New Project',
      workspaceId: 'ws1',
      createdById: 'user1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: project,
      message: 'Project created successfully',
    });
  });

  it('creates project with optional fields', async () => {
    const project = { id: 'p1', name: 'Project' };
    (ProjectMutation.createProject as any).mockResolvedValue(project);

    const req = mockRequest({}, {
      name: 'Project',
      workspaceId: 'ws1',
      description: 'A test project',
      color: '#FF5733',
      icon: 'rocket',
      status: 'PLANNING',
      priority: 'HIGH',
      startDate: '2025-01-01',
      dueDate: '2025-06-30',
    });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(ProjectMutation.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Project',
        workspaceId: 'ws1',
        description: 'A test project',
        color: '#FF5733',
        icon: 'rocket',
        status: 'PLANNING',
        priority: 'HIGH',
        createdById: 'user1',
      }),
    );
  });

  it('throws ValidationError when name is missing', async () => {
    const req = mockRequest({}, { workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when workspaceId is missing', async () => {
    const req = mockRequest({}, { name: 'Project' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when name is empty string', async () => {
    const req = mockRequest({}, { name: '', workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid color format', async () => {
    const req = mockRequest({}, { name: 'Project', workspaceId: 'ws1', color: 'invalid' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid status enum', async () => {
    const req = mockRequest({}, { name: 'Project', workspaceId: 'ws1', status: 'INVALID' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Mutation failed');
    (ProjectMutation.createProject as any).mockRejectedValue(error);

    const req = mockRequest({}, { name: 'Project', workspaceId: 'ws1' });
    const res = mockResponse();
    const next = mockNext();

    await createProject(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateProject ────────────────────────────────────────────────────────────

describe('updateProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates project successfully', async () => {
    const project = { id: 'p1', name: 'Updated' };
    (ProjectMutation.updateProject as any).mockResolvedValue(project);

    const req = mockRequest({ projectId: 'p1' }, { name: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateProject(req, res, next);

    expect(ProjectMutation.updateProject).toHaveBeenCalledWith('user1', 'p1', { name: 'Updated' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: project,
      message: 'Project updated successfully',
    });
  });

  it('updates project with all optional fields', async () => {
    const project = { id: 'p1' };
    (ProjectMutation.updateProject as any).mockResolvedValue(project);

    const req = mockRequest({ projectId: 'p1' }, {
      name: 'Updated',
      description: 'New desc',
      color: '#00FF00',
      icon: 'star',
      status: 'ACTIVE',
      priority: 'LOW',
      startDate: '2025-03-01',
      dueDate: '2025-09-30',
    });
    const res = mockResponse();
    const next = mockNext();

    await updateProject(req, res, next);

    expect(ProjectMutation.updateProject).toHaveBeenCalledWith(
      'user1',
      'p1',
      expect.objectContaining({
        name: 'Updated',
        description: 'New desc',
        color: '#00FF00',
        icon: 'star',
        status: 'ACTIVE',
        priority: 'LOW',
      }),
    );
  });

  it('throws ValidationError for invalid update data', async () => {
    const req = mockRequest({ projectId: 'p1' }, { name: '' });
    const res = mockResponse();
    const next = mockNext();

    await updateProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid color', async () => {
    const req = mockRequest({ projectId: 'p1' }, { color: 'not-a-color' });
    const res = mockResponse();
    const next = mockNext();

    await updateProject(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Not found');
    (ProjectMutation.updateProject as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' }, { name: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateProject(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── deleteProject ────────────────────────────────────────────────────────────

describe('deleteProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes project successfully', async () => {
    (ProjectMutation.deleteProject as any).mockResolvedValue(undefined);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProject(req, res, next);

    expect(ProjectMutation.deleteProject).toHaveBeenCalledWith('user1', 'p1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Project deleted successfully',
    });
  });

  it('forwards error when project not found', async () => {
    const error = new Error('Not found');
    (ProjectMutation.deleteProject as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProject(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── addProjectMember ─────────────────────────────────────────────────────────

describe('addProjectMember', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds member successfully with default role', async () => {
    const member = { id: 'm1', userId: 'user2', role: 'COLLABORATOR' };
    (ProjectMutation.addProjectMember as any).mockResolvedValue(member);

    const req = mockRequest({ projectId: 'p1' }, { userId: 'user2' });
    const res = mockResponse();
    const next = mockNext();

    await addProjectMember(req, res, next);

    expect(ProjectMutation.addProjectMember).toHaveBeenCalledWith('user1', 'p1', { userId: 'user2' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: member,
      message: 'Member added successfully',
    });
  });

  it('adds member with explicit role', async () => {
    const member = { id: 'm1', userId: 'user2', role: 'MANAGER' };
    (ProjectMutation.addProjectMember as any).mockResolvedValue(member);

    const req = mockRequest({ projectId: 'p1' }, { userId: 'user2', role: 'MANAGER' });
    const res = mockResponse();
    const next = mockNext();

    await addProjectMember(req, res, next);

    expect(ProjectMutation.addProjectMember).toHaveBeenCalledWith('user1', 'p1', {
      userId: 'user2',
      role: 'MANAGER',
    });
  });

  it('throws ValidationError when userId is missing', async () => {
    const req = mockRequest({ projectId: 'p1' }, {});
    const res = mockResponse();
    const next = mockNext();

    await addProjectMember(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid role', async () => {
    const req = mockRequest({ projectId: 'p1' }, { userId: 'user2', role: 'INVALID' });
    const res = mockResponse();
    const next = mockNext();

    await addProjectMember(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Already a member');
    (ProjectMutation.addProjectMember as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' }, { userId: 'user2' });
    const res = mockResponse();
    const next = mockNext();

    await addProjectMember(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateProjectMemberRole ──────────────────────────────────────────────────

describe('updateProjectMemberRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates member role successfully', async () => {
    const member = { id: 'm1', role: 'MANAGER' };
    (ProjectMutation.updateProjectMemberRole as any).mockResolvedValue(member);

    const req = mockRequest(
      { projectId: 'p1', memberId: 'm1' },
      { role: 'MANAGER' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectMemberRole(req, res, next);

    expect(ProjectMutation.updateProjectMemberRole).toHaveBeenCalledWith(
      'user1',
      'p1',
      'm1',
      { role: 'MANAGER' },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: member,
      message: 'Member role updated successfully',
    });
  });

  it('throws ValidationError when role is missing', async () => {
    const req = mockRequest({ projectId: 'p1', memberId: 'm1' }, {});
    const res = mockResponse();
    const next = mockNext();

    await updateProjectMemberRole(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid role value', async () => {
    const req = mockRequest(
      { projectId: 'p1', memberId: 'm1' },
      { role: 'INVALID_ROLE' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectMemberRole(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Member not found');
    (ProjectMutation.updateProjectMemberRole as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1', memberId: 'm1' },
      { role: 'VIEWER' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectMemberRole(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── removeProjectMember ──────────────────────────────────────────────────────

describe('removeProjectMember', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes member successfully', async () => {
    (ProjectMutation.removeProjectMember as any).mockResolvedValue(undefined);

    const req = mockRequest({ projectId: 'p1', memberId: 'm1' });
    const res = mockResponse();
    const next = mockNext();

    await removeProjectMember(req, res, next);

    expect(ProjectMutation.removeProjectMember).toHaveBeenCalledWith('user1', 'p1', 'm1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Member removed successfully',
    });
  });

  it('forwards error when member not found', async () => {
    const error = new Error('Member not found');
    (ProjectMutation.removeProjectMember as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1', memberId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await removeProjectMember(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectSections ───────────────────────────────────────────────────────

describe('getProjectSections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sections successfully', async () => {
    const sections = [{ id: 's1', name: 'To Do' }];
    (SectionQuery.getByProject as any).mockResolvedValue(sections);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectSections(req, res, next);

    expect(ProjectAccess.assertProjectAccess).toHaveBeenCalledWith('user1', 'p1');
    expect(SectionQuery.getByProject).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sections });
  });

  it('returns empty array when no sections exist', async () => {
    (SectionQuery.getByProject as any).mockResolvedValue([]);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectSections(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('forwards error to next', async () => {
    const error = new Error('DB error');
    (SectionQuery.getByProject as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectSections(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── createProjectSection ─────────────────────────────────────────────────────

describe('createProjectSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates section successfully', async () => {
    const section = { id: 's1', name: 'In Progress' };
    (SectionMutation.create as any).mockResolvedValue(section);

    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'In Progress', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(SectionMutation.create).toHaveBeenCalledWith(
      { name: 'In Progress', projectId: 'p1' },
      'user1',
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: section });
  });

  it('creates section with optional fields', async () => {
    const section = { id: 's1', name: 'Done' };
    (SectionMutation.create as any).mockResolvedValue(section);

    const req = mockRequest(
      { projectId: 'p1' },
      {
        name: 'Done',
        projectId: 'p1',
        description: 'Completed items',
        color: '#00FF00',
        status: 'COMPLETED',
        position: 3,
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(SectionMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Done',
        projectId: 'p1',
        description: 'Completed items',
        color: '#00FF00',
        status: 'COMPLETED',
        position: 3,
      }),
      'user1',
    );
  });

  it('throws ValidationError when name is missing', async () => {
    const req = mockRequest({ projectId: 'p1' }, { projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when projectId is missing from body', async () => {
    const req = mockRequest({ projectId: 'p1' }, { name: 'Section' });
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid color format', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Section', projectId: 'p1', color: 'red' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Project not found');
    (SectionMutation.create as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Section', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateProjectSection ─────────────────────────────────────────────────────

describe('updateProjectSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates section successfully', async () => {
    const section = { id: 's1', name: 'Updated Section' };
    (SectionMutation.update as any).mockResolvedValue(section);

    const req = mockRequest(
      { sectionId: 's1' },
      { name: 'Updated Section' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectSection(req, res, next);

    expect(SectionMutation.update).toHaveBeenCalledWith('s1', { name: 'Updated Section' }, 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: section });
  });

  it('updates section with all optional fields', async () => {
    const section = { id: 's1' };
    (SectionMutation.update as any).mockResolvedValue(section);

    const req = mockRequest(
      { sectionId: 's1' },
      { name: 'New', description: 'Desc', color: '#ABCDEF', status: 'ACTIVE', position: 5 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectSection(req, res, next);

    expect(SectionMutation.update).toHaveBeenCalledWith(
      's1',
      { name: 'New', description: 'Desc', color: '#ABCDEF', status: 'ACTIVE', position: 5 },
      'user1',
    );
  });

  it('throws ValidationError for empty name', async () => {
    const req = mockRequest({ sectionId: 's1' }, { name: '' });
    const res = mockResponse();
    const next = mockNext();

    await updateProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid status enum', async () => {
    const req = mockRequest(
      { sectionId: 's1' },
      { status: 'INVALID' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Section not found');
    (SectionMutation.update as any).mockRejectedValue(error);

    const req = mockRequest({ sectionId: 's1' }, { name: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── deleteProjectSection ─────────────────────────────────────────────────────

describe('deleteProjectSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes section successfully', async () => {
    (SectionMutation.delete as any).mockResolvedValue(undefined);

    const req = mockRequest({ sectionId: 's1' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProjectSection(req, res, next);

    expect(SectionMutation.delete).toHaveBeenCalledWith('s1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Section deleted',
    });
  });

  it('forwards error when section not found', async () => {
    const error = new Error('Not found');
    (SectionMutation.delete as any).mockRejectedValue(error);

    const req = mockRequest({ sectionId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProjectSection(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── reorderProjectSections ───────────────────────────────────────────────────

describe('reorderProjectSections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reorders sections successfully', async () => {
    (SectionMutation.reorder as any).mockResolvedValue(undefined);

    const req = mockRequest(
      { projectId: 'p1' },
      { sectionIds: ['s3', 's1', 's2'] },
    );
    const res = mockResponse();
    const next = mockNext();

    await reorderProjectSections(req, res, next);

    expect(SectionMutation.reorder).toHaveBeenCalledWith('p1', ['s3', 's1', 's2'], 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Sections reordered',
    });
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Invalid section');
    (SectionMutation.reorder as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { sectionIds: ['s1'] },
    );
    const res = mockResponse();
    const next = mockNext();

    await reorderProjectSections(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectSprints ────────────────────────────────────────────────────────

describe('getProjectSprints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sprint stats successfully', async () => {
    const data = { totalSprints: 3, activeSprint: { id: 'sprint1' } };
    (SprintQuery.getSprintStats as any).mockResolvedValue(data);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectSprints(req, res, next);

    expect(SprintQuery.getSprintStats).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (SprintQuery.getSprintStats as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectSprints(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getActiveSprint ──────────────────────────────────────────────────────────

describe('getActiveSprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns active sprint successfully', async () => {
    const sprint = { id: 'sprint1', status: 'ACTIVE' };
    (SprintQuery.getActiveSprint as any).mockResolvedValue(sprint);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getActiveSprint(req, res, next);

    expect(SprintQuery.getActiveSprint).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('returns null when no active sprint', async () => {
    (SprintQuery.getActiveSprint as any).mockResolvedValue(null);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getActiveSprint(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });
});

// ── getSprintById ────────────────────────────────────────────────────────────

describe('getSprintById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sprint by id successfully', async () => {
    const sprint = { id: 'sprint1', name: 'Sprint 1' };
    (SprintQuery.getById as any).mockResolvedValue(sprint);

    const req = mockRequest({ projectId: 'p1', sprintId: 'sprint1' });
    const res = mockResponse();
    const next = mockNext();

    await getSprintById(req, res, next);

    expect(ProjectAccess.assertProjectAccess).toHaveBeenCalledWith('user1', 'p1');
    expect(SprintQuery.getById).toHaveBeenCalledWith('sprint1', 'p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('forwards error when sprint not found', async () => {
    const error = new Error('Not found');
    (SprintQuery.getById as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1', sprintId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await getSprintById(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── createSprint ─────────────────────────────────────────────────────────────

describe('createSprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates sprint successfully', async () => {
    const sprint = { id: 'sprint1', name: 'Sprint 1' };
    (SprintMutation.create as any).mockResolvedValue(sprint);

    const req = mockRequest(
      { projectId: 'p1' },
      {
        name: 'Sprint 1',
        projectId: 'p1',
        startDate: '2025-01-01',
        endDate: '2025-01-15',
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(SprintMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sprint 1',
        projectId: 'p1',
      }),
      'user1',
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('creates sprint with optional goal', async () => {
    const sprint = { id: 'sprint1' };
    (SprintMutation.create as any).mockResolvedValue(sprint);

    const req = mockRequest(
      { projectId: 'p1' },
      {
        name: 'Sprint 1',
        projectId: 'p1',
        goal: 'Complete login feature',
        startDate: '2025-01-01',
        endDate: '2025-01-15',
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(SprintMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sprint 1',
        goal: 'Complete login feature',
      }),
      'user1',
    );
  });

  it('throws ValidationError when name is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { projectId: 'p1', startDate: '2025-01-01', endDate: '2025-01-15' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when startDate is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Sprint', projectId: 'p1', endDate: '2025-01-15' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when endDate is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Sprint', projectId: 'p1', startDate: '2025-01-01' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when projectId is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Sprint', startDate: '2025-01-01', endDate: '2025-01-15' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Project not found');
    (SprintMutation.create as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Sprint 1', projectId: 'p1', startDate: '2025-01-01', endDate: '2025-01-15' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateSprint ─────────────────────────────────────────────────────────────

describe('updateSprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates sprint successfully', async () => {
    const sprint = { id: 'sprint1', name: 'Updated Sprint' };
    (SprintMutation.update as any).mockResolvedValue(sprint);

    const req = mockRequest(
      { sprintId: 'sprint1' },
      { name: 'Updated Sprint' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateSprint(req, res, next);

    expect(SprintMutation.update).toHaveBeenCalledWith(
      'sprint1',
      { name: 'Updated Sprint' },
      'user1',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('updates sprint with all optional fields', async () => {
    const sprint = { id: 'sprint1' };
    (SprintMutation.update as any).mockResolvedValue(sprint);

    const req = mockRequest(
      { sprintId: 'sprint1' },
      {
        name: 'Sprint',
        goal: 'Goal',
        status: 'COMPLETED',
        startDate: '2025-01-01',
        endDate: '2025-01-15',
        retrospective: 'Good sprint',
        totalPoints: 20,
        completedPoints: 18,
        velocity: 18,
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateSprint(req, res, next);

    expect(SprintMutation.update).toHaveBeenCalledWith(
      'sprint1',
      expect.objectContaining({
        name: 'Sprint',
        goal: 'Goal',
        status: 'COMPLETED',
        retrospective: 'Good sprint',
        totalPoints: 20,
        completedPoints: 18,
        velocity: 18,
      }),
      'user1',
    );
  });

  it('throws ValidationError for invalid sprint status', async () => {
    const req = mockRequest(
      { sprintId: 'sprint1' },
      { status: 'INVALID' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for empty name', async () => {
    const req = mockRequest(
      { sprintId: 'sprint1' },
      { name: '' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Sprint not found');
    (SprintMutation.update as any).mockRejectedValue(error);

    const req = mockRequest({ sprintId: 'sprint1' }, { name: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── deleteSprint ─────────────────────────────────────────────────────────────

describe('deleteSprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes sprint successfully', async () => {
    (SprintMutation.delete as any).mockResolvedValue(undefined);

    const req = mockRequest({ sprintId: 'sprint1' });
    const res = mockResponse();
    const next = mockNext();

    await deleteSprint(req, res, next);

    expect(SprintMutation.delete).toHaveBeenCalledWith('sprint1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Sprint deleted',
    });
  });

  it('forwards error when sprint not found', async () => {
    const error = new Error('Not found');
    (SprintMutation.delete as any).mockRejectedValue(error);

    const req = mockRequest({ sprintId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await deleteSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── completeSprint ───────────────────────────────────────────────────────────

describe('completeSprint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes sprint successfully without retrospective', async () => {
    const sprint = { id: 'sprint1', status: 'COMPLETED' };
    (SprintMutation.complete as any).mockResolvedValue(sprint);

    const req = mockRequest({ sprintId: 'sprint1' }, {});
    const res = mockResponse();
    const next = mockNext();

    await completeSprint(req, res, next);

    expect(SprintMutation.complete).toHaveBeenCalledWith('sprint1', 'user1', undefined);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('completes sprint with retrospective', async () => {
    const sprint = { id: 'sprint1', status: 'COMPLETED', retrospective: 'Great work' };
    (SprintMutation.complete as any).mockResolvedValue(sprint);

    const req = mockRequest(
      { sprintId: 'sprint1' },
      { retrospective: 'Great work' },
    );
    const res = mockResponse();
    const next = mockNext();

    await completeSprint(req, res, next);

    expect(SprintMutation.complete).toHaveBeenCalledWith(
      'sprint1',
      'user1',
      'Great work',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: sprint });
  });

  it('forwards error to next', async () => {
    const error = new Error('Cannot complete sprint');
    (SprintMutation.complete as any).mockRejectedValue(error);

    const req = mockRequest({ sprintId: 'sprint1' }, {});
    const res = mockResponse();
    const next = mockNext();

    await completeSprint(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectMilestones ─────────────────────────────────────────────────────

describe('getProjectMilestones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns milestone stats successfully', async () => {
    const data = { totalMilestones: 5, completed: 2 };
    (MilestoneQuery.getMilestoneStats as any).mockResolvedValue(data);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectMilestones(req, res, next);

    expect(MilestoneQuery.getMilestoneStats).toHaveBeenCalledWith('p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (MilestoneQuery.getMilestoneStats as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectMilestones(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getMilestoneById ─────────────────────────────────────────────────────────

describe('getMilestoneById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns milestone by id successfully', async () => {
    const milestone = { id: 'm1', title: 'Milestone 1' };
    (MilestoneQuery.getById as any).mockResolvedValue(milestone);

    const req = mockRequest({ projectId: 'p1', milestoneId: 'm1' });
    const res = mockResponse();
    const next = mockNext();

    await getMilestoneById(req, res, next);

    expect(ProjectAccess.assertProjectAccess).toHaveBeenCalledWith('user1', 'p1');
    expect(MilestoneQuery.getById).toHaveBeenCalledWith('m1', 'p1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: milestone });
  });

  it('forwards error when milestone not found', async () => {
    const error = new Error('Not found');
    (MilestoneQuery.getById as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1', milestoneId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await getMilestoneById(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── createMilestone ──────────────────────────────────────────────────────────

describe('createMilestone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates milestone successfully', async () => {
    const milestone = { id: 'm1', title: 'M1' };
    (MilestoneMutation.create as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { projectId: 'p1' },
      { title: 'M1', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(MilestoneMutation.create).toHaveBeenCalledWith(
      { title: 'M1', projectId: 'p1' },
      'user1',
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: milestone });
  });

  it('creates milestone with optional fields', async () => {
    const milestone = { id: 'm1' };
    (MilestoneMutation.create as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { projectId: 'p1' },
      {
        title: 'M1',
        projectId: 'p1',
        description: 'A milestone',
        dueDate: '2025-06-01',
        color: '#FF0000',
        icon: 'flag',
        dependsOnId: 'm0',
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(MilestoneMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'M1',
        projectId: 'p1',
        description: 'A milestone',
        color: '#FF0000',
        icon: 'flag',
        dependsOnId: 'm0',
      }),
      'user1',
    );
  });

  it('throws ValidationError when title is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when projectId is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { title: 'M1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid color', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { title: 'M1', projectId: 'p1', color: 'notvalid' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Project not found');
    (MilestoneMutation.create as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { title: 'M1', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateMilestone ──────────────────────────────────────────────────────────

describe('updateMilestone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates milestone successfully', async () => {
    const milestone = { id: 'm1', title: 'Updated' };
    (MilestoneMutation.update as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { milestoneId: 'm1' },
      { title: 'Updated' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(MilestoneMutation.update).toHaveBeenCalledWith(
      'm1',
      { title: 'Updated' },
      'user1',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: milestone });
  });

  it('updates milestone with all optional fields', async () => {
    const milestone = { id: 'm1' };
    (MilestoneMutation.update as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { milestoneId: 'm1' },
      {
        title: 'M1',
        description: 'Desc',
        status: 'COMPLETED',
        progress: 100,
        color: '#0000FF',
        icon: 'trophy',
        dueDate: '2025-12-31',
        completed: true,
        dependsOnId: null,
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(MilestoneMutation.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        title: 'M1',
        description: 'Desc',
        status: 'COMPLETED',
        progress: 100,
        color: '#0000FF',
        icon: 'trophy',
        completed: true,
        dependsOnId: null,
      }),
      'user1',
    );
  });

  it('throws ValidationError for invalid milestone status', async () => {
    const req = mockRequest(
      { milestoneId: 'm1' },
      { status: 'INVALID' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for progress out of range', async () => {
    const req = mockRequest(
      { milestoneId: 'm1' },
      { progress: 150 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for empty title', async () => {
    const req = mockRequest(
      { milestoneId: 'm1' },
      { title: '' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Not found');
    (MilestoneMutation.update as any).mockRejectedValue(error);

    const req = mockRequest({ milestoneId: 'm1' }, { title: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── deleteMilestone ──────────────────────────────────────────────────────────

describe('deleteMilestone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes milestone successfully', async () => {
    (MilestoneMutation.delete as any).mockResolvedValue(undefined);

    const req = mockRequest({ milestoneId: 'm1' });
    const res = mockResponse();
    const next = mockNext();

    await deleteMilestone(req, res, next);

    expect(MilestoneMutation.delete).toHaveBeenCalledWith('m1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Milestone deleted',
    });
  });

  it('forwards error when milestone not found', async () => {
    const error = new Error('Not found');
    (MilestoneMutation.delete as any).mockRejectedValue(error);

    const req = mockRequest({ milestoneId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await deleteMilestone(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateMilestoneProgress ──────────────────────────────────────────────────

describe('updateMilestoneProgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates milestone progress successfully', async () => {
    const milestone = { id: 'm1', progress: 75 };
    (MilestoneMutation.updateProgress as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { milestoneId: 'm1' },
      { progress: 75 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestoneProgress(req, res, next);

    expect(MilestoneMutation.updateProgress).toHaveBeenCalledWith('m1', 75, 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: milestone });
  });

  it('updates progress to 0', async () => {
    const milestone = { id: 'm1', progress: 0 };
    (MilestoneMutation.updateProgress as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { milestoneId: 'm1' },
      { progress: 0 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestoneProgress(req, res, next);

    expect(MilestoneMutation.updateProgress).toHaveBeenCalledWith('m1', 0, 'user1');
  });

  it('updates progress to 100', async () => {
    const milestone = { id: 'm1', progress: 100 };
    (MilestoneMutation.updateProgress as any).mockResolvedValue(milestone);

    const req = mockRequest(
      { milestoneId: 'm1' },
      { progress: 100 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestoneProgress(req, res, next);

    expect(MilestoneMutation.updateProgress).toHaveBeenCalledWith('m1', 100, 'user1');
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (MilestoneMutation.updateProgress as any).mockRejectedValue(error);

    const req = mockRequest(
      { milestoneId: 'm1' },
      { progress: 50 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateMilestoneProgress(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getProjectViews ──────────────────────────────────────────────────────────

describe('getProjectViews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns project views successfully', async () => {
    const views = [{ id: 'v1', name: 'Board View' }];
    (ProjectViewQuery.getByProject as any).mockResolvedValue(views);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectViews(req, res, next);

    expect(ProjectViewQuery.getByProject).toHaveBeenCalledWith('p1', 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: views });
  });

  it('returns empty array when no views exist', async () => {
    (ProjectViewQuery.getByProject as any).mockResolvedValue([]);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectViews(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (ProjectViewQuery.getByProject as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await getProjectViews(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── createProjectView ────────────────────────────────────────────────────────

describe('createProjectView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates view successfully', async () => {
    const view = { id: 'v1', name: 'Kanban Board' };
    (ProjectViewMutation.create as any).mockResolvedValue(view);

    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'Kanban Board', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(ProjectViewMutation.create).toHaveBeenCalledWith(
      { name: 'Kanban Board', projectId: 'p1', createdById: 'user1' },
      'user1',
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: view });
  });

  it('creates view with optional fields', async () => {
    const view = { id: 'v1' };
    (ProjectViewMutation.create as any).mockResolvedValue(view);

    const req = mockRequest(
      { projectId: 'p1' },
      {
        name: 'Board',
        projectId: 'p1',
        description: 'My board',
        type: 'KANBAN',
        filters: { status: 'ACTIVE' },
        sort: { field: 'createdAt' },
        config: { columns: 5 },
        isDefault: true,
        visibility: 'SHARED',
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(ProjectViewMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Board',
        projectId: 'p1',
        description: 'My board',
        type: 'KANBAN',
        isDefault: true,
        visibility: 'SHARED',
        createdById: 'user1',
      }),
      'user1',
    );
  });

  it('throws ValidationError when name is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError when projectId is missing', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'View' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid type enum', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'View', projectId: 'p1', type: 'INVALID' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid visibility enum', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'View', projectId: 'p1', visibility: 'PUBLIC' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Project not found');
    (ProjectViewMutation.create as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { name: 'View', projectId: 'p1' },
    );
    const res = mockResponse();
    const next = mockNext();

    await createProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateProjectView ────────────────────────────────────────────────────────

describe('updateProjectView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates view successfully', async () => {
    const view = { id: 'v1', name: 'Updated View' };
    (ProjectViewMutation.update as any).mockResolvedValue(view);

    const req = mockRequest(
      { viewId: 'v1' },
      { name: 'Updated View' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectView(req, res, next);

    expect(ProjectViewMutation.update).toHaveBeenCalledWith(
      'v1',
      { name: 'Updated View' },
      'user1',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: view });
  });

  it('updates view with all optional fields', async () => {
    const view = { id: 'v1' };
    (ProjectViewMutation.update as any).mockResolvedValue(view);

    const req = mockRequest(
      { viewId: 'v1' },
      {
        name: 'View',
        description: 'Desc',
        type: 'LIST',
        filters: { priority: 'HIGH' },
        sort: { field: 'name' },
        config: { pageSize: 20 },
        isDefault: false,
        visibility: 'PRIVATE',
      },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectView(req, res, next);

    expect(ProjectViewMutation.update).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        name: 'View',
        description: 'Desc',
        type: 'LIST',
        isDefault: false,
        visibility: 'PRIVATE',
      }),
      'user1',
    );
  });

  it('throws ValidationError for empty name', async () => {
    const req = mockRequest(
      { viewId: 'v1' },
      { name: '' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for invalid type', async () => {
    const req = mockRequest(
      { viewId: 'v1' },
      { type: 'INVALID' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('View not found');
    (ProjectViewMutation.update as any).mockRejectedValue(error);

    const req = mockRequest({ viewId: 'v1' }, { name: 'Updated' });
    const res = mockResponse();
    const next = mockNext();

    await updateProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── deleteProjectView ────────────────────────────────────────────────────────

describe('deleteProjectView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes view successfully', async () => {
    (ProjectViewMutation.delete as any).mockResolvedValue(undefined);

    const req = mockRequest({ viewId: 'v1' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProjectView(req, res, next);

    expect(ProjectViewMutation.delete).toHaveBeenCalledWith('v1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'View deleted',
    });
  });

  it('forwards error when view not found', async () => {
    const error = new Error('Not found');
    (ProjectViewMutation.delete as any).mockRejectedValue(error);

    const req = mockRequest({ viewId: 'nonexistent' });
    const res = mockResponse();
    const next = mockNext();

    await deleteProjectView(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── getUserFavorites ─────────────────────────────────────────────────────────

describe('getUserFavorites', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns user favorites successfully', async () => {
    const data = [{ id: 'f1', projectId: 'p1' }];
    (FavoriteQuery.getByUser as any).mockResolvedValue(data);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserFavorites(req, res, next);

    expect(FavoriteQuery.getByUser).toHaveBeenCalledWith('user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it('returns empty array when no favorites', async () => {
    (FavoriteQuery.getByUser as any).mockResolvedValue([]);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserFavorites(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('forwards error to next', async () => {
    const error = new Error('DB error');
    (FavoriteQuery.getByUser as any).mockRejectedValue(error);

    const req = mockRequest();
    const res = mockResponse();
    const next = mockNext();

    await getUserFavorites(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── checkFavorite ────────────────────────────────────────────────────────────

describe('checkFavorite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when project is favorited', async () => {
    (FavoriteQuery.isFavorited as any).mockResolvedValue(true);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await checkFavorite(req, res, next);

    expect(FavoriteQuery.isFavorited).toHaveBeenCalledWith('p1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { favorited: true },
    });
  });

  it('returns false when project is not favorited', async () => {
    (FavoriteQuery.isFavorited as any).mockResolvedValue(false);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await checkFavorite(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { favorited: false },
    });
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (FavoriteQuery.isFavorited as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await checkFavorite(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── toggleFavorite ───────────────────────────────────────────────────────────

describe('toggleFavorite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toggles favorite on (adds)', async () => {
    const result = { favorited: true, favorite: { id: 'f1' } };
    (FavoriteMutation.toggle as any).mockResolvedValue(result);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await toggleFavorite(req, res, next);

    expect(FavoriteMutation.toggle).toHaveBeenCalledWith('p1', 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('toggles favorite off (removes)', async () => {
    const result = { favorited: false, favorite: null };
    (FavoriteMutation.toggle as any).mockResolvedValue(result);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await toggleFavorite(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('forwards error to next', async () => {
    const error = new Error('Not found');
    (FavoriteMutation.toggle as any).mockRejectedValue(error);

    const req = mockRequest({ projectId: 'p1' });
    const res = mockResponse();
    const next = mockNext();

    await toggleFavorite(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ── updateFavorite ───────────────────────────────────────────────────────────

describe('updateFavorite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates favorite successfully', async () => {
    const fav = { id: 'f1', group: 'work', sortOrder: 5 };
    (FavoriteMutation.update as any).mockResolvedValue(fav);

    const req = mockRequest(
      { projectId: 'p1' },
      { group: 'work', sortOrder: 5 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(FavoriteMutation.update).toHaveBeenCalledWith(
      'p1',
      'user1',
      { group: 'work', sortOrder: 5 },
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fav });
  });

  it('updates favorite with null group and note', async () => {
    const fav = { id: 'f1', group: null, note: null };
    (FavoriteMutation.update as any).mockResolvedValue(fav);

    const req = mockRequest(
      { projectId: 'p1' },
      { group: null, note: null },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(FavoriteMutation.update).toHaveBeenCalledWith(
      'p1',
      'user1',
      { group: null, note: null },
    );
  });

  it('accepts empty group (string without min length constraint)', async () => {
    const fav = { id: 'f1', group: '' };
    (FavoriteMutation.update as any).mockResolvedValue(fav);

    const req = mockRequest(
      { projectId: 'p1' },
      { group: '' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(FavoriteMutation.update).toHaveBeenCalledWith(
      'p1',
      'user1',
      { group: '' },
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fav });
  });

  it('throws ValidationError for negative sortOrder', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { sortOrder: -1 },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('throws ValidationError for note exceeding max length', async () => {
    const req = mockRequest(
      { projectId: 'p1' },
      { note: 'x'.repeat(201) },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation error' }),
    );
  });

  it('forwards mutation error to next', async () => {
    const error = new Error('Favorite not found');
    (FavoriteMutation.update as any).mockRejectedValue(error);

    const req = mockRequest(
      { projectId: 'p1' },
      { group: 'work' },
    );
    const res = mockResponse();
    const next = mockNext();

    await updateFavorite(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
