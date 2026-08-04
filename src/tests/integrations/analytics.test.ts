import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';

import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
  createProject,
  createTask,
} from '../factories/index.js';

import { authHeaders } from '../helpers/auth.js';
import { WorkspaceRole, TaskStatus } from '@prisma/client';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('DIRECT_URL:', process.env.DIRECT_URL);
async function seedBasicWorkspaceData(userId: string, workspaceId: string) {
  const project = await createProject(workspaceId, userId);

  await createTask(workspaceId, userId, {
    projectId: project.id,
    status: TaskStatus.COMPLETED,
  });

  await createTask(workspaceId, userId, {
    projectId: project.id,
    status: TaskStatus.TODO,
  });

  return { project };
}

// ─────────────────────────────────────────────────────────────
// GET /overview
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/overview', () => {
  it('200 — returns analytics overview for admin/owner', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "PRO"});

    await seedBasicWorkspaceData(user.id, workspace.id);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/overview`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(res.body.data).toHaveProperty('kpis');
    expect(res.body.data).toHaveProperty('taskStatus');
    expect(res.body.data).toHaveProperty('projectStatus');
    expect(res.body.data).toHaveProperty('tasksByPriority');
    expect(res.body.data).toHaveProperty('deadlineRisk');
  });

  it('403 — non-member cannot access', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/overview`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it('401 — unauthenticated', async () => {
    const { workspace } = await createWorkspaceWithOwner({}, {plan: "PRO"});

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/overview`);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/trends
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/tasks/trends', () => {
  it('200 — returns task trends', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "PRO"});

    await seedBasicWorkspaceData(user.id, workspace.id);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/tasks/trends`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('completionTrend');
    expect(res.body.data).toHaveProperty('overdueTrend');
  });
});

// ─────────────────────────────────────────────────────────────
// GET /projects/health
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/projects/health', () => {
  it('200 — returns project health metrics', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "PRO"});

    await createProject(workspace.id, user.id);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/health`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /members/contribution
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/members/contribution', () => {
  it('200 — returns member contributions', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "BUSINESS"});

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/members/contribution`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /time/summary
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/time/summary', () => {
  it('200 — returns time tracking summary', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "PRO"});

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/time/summary`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalHours');
    expect(res.body.data).toHaveProperty('avgHoursPerMember');
    expect(res.body.data).toHaveProperty('projectBreakdown');
  });
});

// ─────────────────────────────────────────────────────────────
// GET /activity/trends
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/activity/trends', () => {
  it('200 — returns activity trends', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "BUSINESS"});

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/activity/trends`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('volumeTrend');
    expect(res.body.data).toHaveProperty('mostActiveDay');
  });
});

// ─────────────────────────────────────────────────────────────
// GET /workload
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/analytics/:workspaceId/workload', () => {
  it('200 — returns workload per member', async () => {
    const { user, workspace } = await createWorkspaceWithOwner({}, {plan: "BUSINESS"});

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/workload`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});