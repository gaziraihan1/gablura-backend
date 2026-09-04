// Tests Activity system: query, access control, deletion, clearing

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';

import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  createActivity,
  addMemberToWorkspace,
  assignUserToTask,
} from '../factories/index.js';

import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────

let user: any;
let workspace: any;
let project: any;
let task: any;

beforeEach(async () => {
  const setup = await createWorkspaceWithOwner({}, {plan: "FREE"});
  user = setup.user;
  workspace = setup.workspace;

  project = await createProject(workspace.id, user.id);
  task = await createTask(workspace.id, user.id, {
    projectId: project.id,
  });
  process.env.ENFORCE_CSRF_IN_TESTS = 'true';
});
afterEach(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────
// GET /api/activities
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/activities', () => {
  it('200 — returns user activities', async () => {
    await createActivity(user.id, workspace.id, {
      taskId: task.id,
    });

    const res = await request(app)
      .get('/api/v1/activities')
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('200 — supports multiple filters (workspaceId, action, entityType)', async () => {
    await createActivity(user.id, workspace.id, {
      action: 'CREATED',
      entityType: 'TASK',
    });

    const res = await request(app)
      .get('/api/v1/activities')
      .query({ 
        workspaceId: workspace.id,
        action: 'CREATED',
        entityType: 'TASK'
      })
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].action).toBe('CREATED');
    expect(res.body.data[0].entityType).toBe('TASK');
  });

  it('200 — supports date filters', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString();

    await prisma.activity.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        action: 'CREATED',
        entityType: 'TASK',
        entityId: 'test',
        createdAt: yesterday,
        workspaceSlug: workspace.slug
      } as any,
    });

    const res = await request(app)
      .get('/api/v1/activities')
      .query({ startDate: dateStr })
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('excludes Gablura-admin audit rows (e.g. AI cap changes) from the user feed', async () => {
    await createActivity(user.id, workspace.id, {
      taskId: task.id,
    });
    // Admin-driven workspace-limits audit row (same shape serviceUpdateWorkspaceLimits writes)
    await prisma.activity.create({
      data: {
        action: 'UPDATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {
          source: 'gablura-admin',
          changes: {
            aiDailyCalls: { from: null, to: 9000 },
          },
        },
      },
    });

    const res = await request(app)
      .get('/api/v1/activities')
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.some((a: any) => a.metadata?.source === 'gablura-admin'),
    ).toBe(false);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/v1/activities');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /workspace/:workspaceId
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/activities/workspace/:workspaceId', () => {
  it('200 — member can access workspace activities', async () => {
    await createActivity(user.id, workspace.id);

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('200 — anyone can access public workspace activities', async () => {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { isPublic: true },
    });
    await createActivity(user.id, workspace.id);

    const other = await createUser();

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(other));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('shows workspace-limit changes (Gablura-admin audit rows) to the workspace owner', async () => {
    await createActivity(user.id, workspace.id);
    await prisma.activity.create({
      data: {
        action: 'UPDATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {
          source: 'gablura-admin',
          changes: {
            aiMonthlyTokens: { from: 500000, to: 100000000 },
          },
        },
      },
    });

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(user)); // user is the workspace owner

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.some((a: any) => a.metadata?.source === 'gablura-admin'),
    ).toBe(true);
  });

  it('shows workspace-limit changes (Gablura-admin audit rows) to workspace admins', async () => {
    await createActivity(user.id, workspace.id);
    await prisma.activity.create({
      data: {
        action: 'UPDATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {
          source: 'gablura-admin',
          changes: {
            maxStorage: { from: 1024, to: 20000 },
          },
        },
      },
    });

    const workspaceAdmin = await createUser();
    await addMemberToWorkspace(workspaceAdmin.id, workspace.id, 'ADMIN');

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(workspaceAdmin));

    expect(res.status).toBe(200);
    expect(
      res.body.data.some((a: any) => a.metadata?.source === 'gablura-admin'),
    ).toBe(true);
  });

  it('hides workspace-limit changes (Gablura-admin audit rows) from regular members', async () => {
    await createActivity(user.id, workspace.id);
    await prisma.activity.create({
      data: {
        action: 'UPDATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {
          source: 'gablura-admin',
          changes: {
            aiDailyCalls: { from: null, to: 9000 },
          },
        },
      },
    });

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id); // MEMBER role

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.some((a: any) => a.metadata?.source === 'gablura-admin'),
    ).toBe(false);
  });

  it('hides workspace-limit changes from public non-member viewers', async () => {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { isPublic: true },
    });
    await createActivity(user.id, workspace.id);
    await prisma.activity.create({
      data: {
        action: 'UPDATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {
          source: 'gablura-admin',
          changes: {
            plan: { from: 'PRO', to: 'ENTERPRISE' },
          },
        },
      },
    });

    const outsider = await createUser();
    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.some((a: any) => a.metadata?.source === 'gablura-admin'),
    ).toBe(false);
  });

  it('403 — non-member cannot access private workspace', async () => {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { isPublic: false },
    });
    const other = await createUser();

    const res = await request(app)
      .get(`/api/v1/activities/workspace/${workspace.id}`)
      .set(authHeaders(other));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /task/:taskId
// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/activities/task/:taskId', () => {
  it('200 — assigned user can access task activities', async () => {
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id);
    await assignUserToTask(task.id, member.id);

    await createActivity(member.id, workspace.id, {
      taskId: task.id,
    });

    const res = await request(app)
      .get(`/api/v1/activities/task/${task.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
  });

  it('403 — user without access', async () => {
    const other = await createUser();

    const res = await request(app)
      .get(`/api/v1/activities/task/${task.id}`)
      .set(authHeaders(other));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/activities/clear
// ─────────────────────────────────────────────────────────────

describe('DELETE /api/v1/activities/clear', () => {
  it('200 — clears all user activities', async () => {
    await createActivity(user.id, workspace.id);

    const res = await request(app)
      .delete('/api/v1/activities/clear')
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBeGreaterThanOrEqual(1);
  });

  it('200 — supports filtering by workspace', async () => {
    const otherWorkspaceSetup = await createWorkspaceWithOwner({}, {plan: "FREE"});
    const otherWorkspace = otherWorkspaceSetup.workspace;

    await createActivity(user.id, workspace.id);
    await createActivity(user.id, otherWorkspace.id);

    const res = await request(app)
      .delete('/api/v1/activities/clear')
      .query({ workspaceId: workspace.id })
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const remaining = await prisma.activity.findMany({
      where: { userId: user.id },
    });

    expect(remaining.every(a => a.workspaceId !== workspace.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/activities/:activityId
// ─────────────────────────────────────────────────────────────

describe('DELETE /api/v1/activities/:activityId', () => {
  it('200 — user deletes own activity', async () => {
    const activity = await createActivity(user.id, workspace.id);

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
  });

  it('403 — non-owner cannot delete', async () => {
    const activity = await createActivity(user.id, workspace.id);

    const other = await createUser();
    await addMemberToWorkspace(other.id, workspace.id);

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set(await authWithCsrfHeaders(other));

    expect(res.status).toBe(403);
  });

  it('200 — workspace ADMIN can delete activity', async () => {
    const activity = await createActivity(user.id, workspace.id);

    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, 'ADMIN');

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
  });

  it('404 — activity not found', async () => {
    const res = await request(app)
      .delete('/api/v1/activities/fake-id-123')
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });
});