import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { createUser, createWorkspaceWithOwner } from '../../factories/index.js';
import { authHeaders } from '../../helpers/auth.js';

// ─── Test Setup ───────────────────────────────────────────────────────────────

let user: Awaited<ReturnType<typeof createUser>>;
let workspace: Awaited<ReturnType<typeof createWorkspaceWithOwner>>['workspace'];
let workspaceOwner: Awaited<ReturnType<typeof createWorkspaceWithOwner>>['user'];

beforeAll(async () => {
  user = await createUser({ email: 'integration-test@example.com' });
  const ws = await createWorkspaceWithOwner();
  workspace = ws.workspace;
  workspaceOwner = ws.user;
});

afterAll(async () => {
  await prisma.integration.deleteMany();
  await prisma.$disconnect();
});

// ─── Personal Integration Tests ───────────────────────────────────────────────

describe('Personal Integrations', () => {
  describe('GET /api/v1/user/integrations', () => {
    it('should return empty array for user with no integrations', async () => {
      const res = await request(app)
        .get('/api/v1/user/integrations')
        .set(authHeaders(user));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/v1/user/integrations');

      expect(res.status).toBe(401);
    });
  });
});

// ─── Workspace Integration Tests ──────────────────────────────────────────────

describe('Workspace Integrations', () => {
  describe('GET /api/v1/workspace-integrations/:slug', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get(`/api/v1/workspace-integrations/${workspace.slug}`);

      expect(res.status).toBe(401);
    });
  });
});
