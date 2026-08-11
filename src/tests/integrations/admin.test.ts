// src/tests/admin/admin.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for GET /api/v1/admin/* and mutating PATCH/POST routes.
//
// Conventions:
//   • authHeaders()          — GET requests (no CSRF needed)
//   • authWithCsrfHeaders()  — PATCH / POST requests
//   • All state is seeded per-test; afterEach in setup.ts truncates all tables
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
// import { WorkspacePlan, WorkspaceRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { CacheClient, CACHE_KEYS } from '../../lib/redis/cache.client.js';

import {
  createUser,
  createAdminUser,
  // createWorkspace,
  createWorkspaceWithOwner,
  // addMemberToWorkspace,
  createProject,
  // createTask,
  // createMeeting,
  // createAnnouncement,
} from '../factories/index.js';

import {
  authHeaders,
  authWithCsrfHeaders,
} from '../helpers/auth.js';

const BASE = '/api/v1/admin';

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard — all admin routes require ADMIN role
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin route auth guards', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get(`${BASE}/stats`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin user calls an admin route', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get(`${BASE}/stats`)
      .set(authHeaders(user));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /stats
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/stats', () => {
  it('returns 200 with a stats object for an admin user', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/stats`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({
      users:      expect.any(Number),
      workspaces: expect.any(Number),
    });
  });

  it('reflects newly created entities in the counts', async () => {
    const admin = await createAdminUser();
    await createWorkspaceWithOwner();
    await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/stats`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    // admin user + 2 owners = at least 3 users; at least 2 workspaces
    expect(res.body.data.totals.users).toBeGreaterThanOrEqual(3);
    expect(res.body.data.totals.workspaces).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspaces
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/workspaces', () => {
  it('returns 200 with a paginated workspace list', async () => {
    const admin = await createAdminUser();
    await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/workspaces`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data ?? res.body.workspaces ?? res.body)).toBe(true);
  });

  it('filters by search term', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner({}, { name: 'Acme Corp Unique' });
    await createWorkspaceWithOwner({}, { name: 'Other Inc' });

    const res = await request(app)
      .get(`${BASE}/workspaces?search=Acme`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.workspaces ?? res.body;
    expect(list.some((w: any) => w.id === workspace.id || w.name === 'Acme Corp Unique')).toBe(true);
  });

  it('respects page and pageSize query params', async () => {
    const admin = await createAdminUser();
    // Seed 5 workspaces
    for (let i = 0; i < 5; i++) await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/workspaces?page=1&pageSize=2`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.workspaces ?? res.body;
    expect(list.length).toBeLessThanOrEqual(2);
  });

  it('rejects pageSize > 100', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/workspaces?pageSize=101`)
      .set(authHeaders(admin));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspaces/:slug
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/workspaces/:slug', () => {
  it('returns workspace detail for a valid slug', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/workspaces/${workspace.slug}`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.id ?? res.body.workspace?.id).toBe(workspace.id);
  });

  it('returns 404 for a non-existent slug', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/workspaces/does-not-exist-xyz`)
      .set(authHeaders(admin));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /users
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/users', () => {
  it('returns 200 with a user list', async () => {
    const admin = await createAdminUser();
    await createUser();

    const res = await request(app)
      .get(`${BASE}/users`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.users ?? res.body;
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('filters users by search term', async () => {
    const admin = await createAdminUser();
    const target = await createUser({ email: 'unique-target-user@example.com' });

    const res = await request(app)
      .get(`${BASE}/users?search=unique-target-user`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.users ?? res.body;
    expect(list.some((u: any) => u.id === target.id)).toBe(true);
  });

  it('does not expose password hashes', async () => {
    const admin = await createAdminUser();
    await createUser();

    const res = await request(app)
      .get(`${BASE}/users`)
      .set(authHeaders(admin));

    const list: any[] = res.body.data ?? res.body.users ?? res.body;
    for (const u of list) {
      expect(u.password).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/users/:id', () => {
  it('returns user detail for a valid id', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app)
      .get(`${BASE}/users/${user.id}`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.id ?? res.body.user?.id).toBe(user.id);
  });

  it('returns 404 for a non-existent user id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/users/non-existent-id-xyz`)
      .set(authHeaders(admin));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /projects
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/projects', () => {
  it('returns 200 with a project list', async () => {
    const admin = await createAdminUser();
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id);

    const res = await request(app)
      .get(`${BASE}/projects`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.projects ?? res.body;
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('filters projects by workspaceId', async () => {
    const admin = await createAdminUser();
    const { user, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    const proj = await createProject(ws1.id, user.id, { name: 'WS1 Project' });
    await createProject(ws2.id, u2.id, { name: 'WS2 Project' });

    const res = await request(app)
      .get(`${BASE}/projects?workspaceId=${ws1.id}`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    const list: any[] = res.body.data ?? res.body.projects ?? res.body;
    expect(list.every((p: any) => p.workspace.id === ws1.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/billing', () => {
  it('returns 200 with billing data', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/billing`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /activity
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/activity', () => {
  it('returns 200 with an activity list', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get(`${BASE}/activity`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /workspaces/:slug/limits
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/workspaces/:slug/limits', () => {
  it('updates plan and limits, returns updated workspace', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'BUSINESS', maxMembers: 50, maxStorage: 10000 });

    expect(res.status).toBe(200);
    expect(res.body.data.plan ?? res.body.workspace?.plan).toBe('BUSINESS');
  });

  it('returns 400 for invalid plan enum', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'ENTERPRISE', maxMembers: 10, maxStorages: 1000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when maxMembers is 0', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: 0, maxStorage: 1000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when maxStorage is 0', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: 10, maxStorage: 0 });

    expect(res.status).toBe(400);
  });

  it('accepts -1 as unlimited for both fields', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: -1, maxStorage: -1 });

    expect(res.status).toBe(200);
  });

  it('sets and persists AI limit overrides for an ENTERPRISE workspace', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({
        plan: 'ENTERPRISE',
        maxMembers: -1,
        maxStorage: -1,
        aiDailyCalls: 9000,
        aiMonthlyTokens: 100_000_000,
        aiMaxOutputTokens: 8192,
      });

    expect(res.status).toBe(200);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.plan).toBe('ENTERPRISE');
    expect(fresh?.aiDailyCalls).toBe(9000);
    expect(fresh?.aiMonthlyTokens).toBe(100_000_000);
    expect(fresh?.aiMaxOutputTokens).toBe(8192);

    // The detail endpoint surfaces the overrides back to the admin UI
    const detail = await request(app)
      .get(`${BASE}/workspaces/${workspace.slug}`)
      .set(authHeaders(admin));
    expect(detail.status).toBe(200);
    expect(detail.body.data?.aiDailyCalls).toBe(9000);
  });

  it('rejects non-positive AI overrides', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: 10, maxStorage: 1000, aiDailyCalls: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent workspace slug', async () => {
    const admin = await createAdminUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/ghost-workspace/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: 10, maxStorage: 1000 });

    expect(res.status).toBe(404);
  });

  it('returns 403 when called by a non-admin', async () => {
    const user = await createUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/limits`)
      .set(headers)
      .send({ plan: 'PRO', maxMembers: 10, maxStorage: 1000 });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /users/:id/ban
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id/ban', () => {
  it('bans the target user and returns 200', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/ban`)
      .set(headers)
      .send({ reason: 'Spam activity detected' });

    expect(res.status).toBe(200);

    // Verify DB state
    const fresh = await prisma.user.findUnique({ where: { id: target.id } });
    expect(fresh?.bannedAt).toBeInstanceOf(Date);
    expect(fresh?.banReason).toBe('Spam activity detected');
  });

  it('returns 400 when reason is empty', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/ban`)
      .set(headers)
      .send({ reason: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/ban`)
      .set(headers)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 when reason exceeds 500 chars', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/ban`)
      .set(headers)
      .send({ reason: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when called by a non-admin', async () => {
    const user    = await createUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/ban`)
      .set(headers)
      .send({ reason: 'Test' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent user', async () => {
    const admin   = await createAdminUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/non-existent-id/ban`)
      .set(headers)
      .send({ reason: 'Test' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /users/:id/unban
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/users/:id/unban', () => {
  it('unbans a previously banned user', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser({ bannedAt: new Date(), banReason: 'Old reason' });
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/unban`)
      .set(headers);

    expect(res.status).toBe(200);

    const fresh = await prisma.user.findUnique({ where: { id: target.id } });
    expect(fresh?.bannedAt).toBeNull();
    expect(fresh?.banReason).toBeNull();
  });

  it('returns 404 for a non-existent user', async () => {
    const admin   = await createAdminUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/users/non-existent-id/unban`)
      .set(headers);

    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-admin user', async () => {
    const user    = await createUser();
    const target  = await createUser();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .patch(`${BASE}/users/${target.id}/unban`)
      .set(headers);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspaces/:slug — delete (soft or hard)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/admin/workspaces/:slug — soft delete', () => {
  it('soft deletes the workspace by default (hardDelete: false)', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false, reason: 'Policy violation' });

    expect(res.status).toBe(200);

    // Record should still exist, just marked as deleted
    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh).not.toBeNull();
    expect(fresh?.deletedAt).toBeInstanceOf(Date);
  });

  it('preserves the workspace data on soft delete', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false });

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.name).toBe(workspace.name);
  });
});

describe('POST /api/v1/admin/workspaces/:slug — hard delete', () => {
  it('permanently removes the workspace when hardDelete is true', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: true });

    expect(res.status).toBe(200);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh).toBeNull();
  });

  it('returns 404 for a non-existent workspace', async () => {
    const admin = await createAdminUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .post(`${BASE}/workspaces/ghost-slug-xyz`)
      .set(headers)
      .send({ hardDelete: true });

    expect(res.status).toBe(404);
  });

  it('returns 400 when reason exceeds 500 chars', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false, reason: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /workspaces/:slug/restore
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/workspaces/:slug/restore', () => {
  it('restores a soft-deleted workspace', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    // Soft-delete first
    await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false, reason: 'Test' });

    // Now restore
    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/restore`)
      .set(headers);

    expect(res.status).toBe(200);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.deletedAt).toBeNull();
  });

  it('returns 404 for a non-existent workspace slug', async () => {
    const admin = await createAdminUser();
    const headers = await authWithCsrfHeaders(admin);

    const res = await request(app)
      .patch(`${BASE}/workspaces/non-existent-slug/restore`)
      .set(headers);

    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/restore`)
      .set(headers);

    expect(res.status).toBe(403);
  });

  it('invalidates the cached workspace on restore (no stale deletedAt)', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(admin);

    // Simulate a workspace read that populated the metadata cache while the
    // workspace was suspended (deletedAt present in the cached copy).
    const staleCopy = {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      deletedAt: new Date(),
    };
    await CacheClient.set(CACHE_KEYS.workspaceBySlug(workspace.slug), staleCopy, 3600);

    // Soft-delete then restore
    await request(app)
      .post(`${BASE}/workspaces/${workspace.slug}`)
      .set(headers)
      .send({ hardDelete: false, reason: 'Test' });
    await request(app)
      .patch(`${BASE}/workspaces/${workspace.slug}/restore`)
      .set(headers);

    // The cached copy must be gone — otherwise members would still see the
    // workspace as suspended/not-found for up to the TTL after a restore.
    const cached = await CacheClient.get<any>(CACHE_KEYS.workspaceBySlug(workspace.slug));
    expect(cached).toBeNull();
  });
});