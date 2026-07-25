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

  describe('GET /api/v1/user/integrations/stats', () => {
    it('should return integration stats', async () => {
      const res = await request(app)
        .get('/api/v1/user/integrations/stats')
        .set(authHeaders(user));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('active');
      expect(res.body.data).toHaveProperty('inactive');
      expect(res.body.data).toHaveProperty('needsAttention');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/v1/user/integrations/stats');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/user/integrations/auth', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/user/integrations/auth')
        .send({ provider: 'github' });

      expect(res.status).toBe(401);
    });

    it('should return validation error for invalid provider', async () => {
      const res = await request(app)
        .post('/api/v1/user/integrations/auth')
        .set(authHeaders(user))
        .send({ provider: 'invalid' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/user/integrations/callback', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/user/integrations/callback')
        .send({ code: 'test', state: 'test', provider: 'github', redirectUri: 'http://localhost:3000/callback' });

      expect(res.status).toBe(401);
    });

    it('should return validation error for missing fields', async () => {
      const res = await request(app)
        .post('/api/v1/user/integrations/callback')
        .set(authHeaders(user))
        .send({ code: 'test' });

      expect(res.status).toBe(400);
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

    it('should return integrations for workspace member', async () => {
      const res = await request(app)
        .get(`/api/v1/workspace-integrations/${workspace.slug}`)
        .set(authHeaders(workspaceOwner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 400 for non-existent workspace', async () => {
      const res = await request(app)
        .get('/api/v1/workspace-integrations/non-existent')
        .set(authHeaders(user));

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/workspace-integrations/:slug/auth', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post(`/api/v1/workspace-integrations/${workspace.slug}/auth`)
        .send({ provider: 'github' });

      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const nonAdmin = await createUser({ email: 'non-admin@test.com' });
      const res = await request(app)
        .post(`/api/v1/workspace-integrations/${workspace.slug}/auth`)
        .set(authHeaders(nonAdmin))
        .send({ provider: 'github' });

      expect(res.status).toBe(403);
    });
  });
});

// ─── Webhook Tests ───────────────────────────────────────────────────────────

describe('Webhooks', () => {
  describe('POST /api/v1/webhooks/:provider', () => {
    it('should accept GitHub webhook', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/github')
        .send({ action: 'ping' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should accept Slack webhook', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/slack')
        .send({ type: 'url_verification', challenge: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should accept Google Calendar webhook', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/google-calendar')
        .send({ syncToken: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
