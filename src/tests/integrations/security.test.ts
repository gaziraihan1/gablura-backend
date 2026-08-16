import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../redis/redis.client.js';
import { createWorkspaceWithOwner, createProject, createTask } from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';

/**
 * Security Tests
 * 
 * This suite combines Resource Ownership (IDOR) and Infrastructure-level 
 * security tests to verify the application's robustness against attacks.
 */
describe('🔐 Security Tests', () => {
  
  describe('Resource Update Authorization (IDOR)', () => {
    it('should prevent a user from updating a project they did not create', async () => {
      // Setup: Two users and two projects
      const { user: owner, workspace: ownerWs } = await createWorkspaceWithOwner();
      const { user: attacker } = await createWorkspaceWithOwner();
      
      const project = await createProject(ownerWs.id, owner.id, { name: 'Owner Project' });
      
      const headers = await authWithCsrfHeaders(attacker);
      
      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(headers)
        .send({ name: 'Hacked Project Name' });
      
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should prevent a user from updating a task they did not create and are not assigned to', async () => {
      // Setup: Two users
      const { user: owner, workspace: ownerWs } = await createWorkspaceWithOwner();
      const { user: attacker } = await createWorkspaceWithOwner();
      
      const task = await createTask(ownerWs.id, owner.id, { title: 'Owner Task' });
      
      const headers = await authWithCsrfHeaders(attacker);
      
      const res = await request(app)
        .put(`/api/v1/tasks/${task.id}`)
        .set(headers)
        .send({ title: 'Hacked Task Title' });
      
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a user to update a task they are assigned to if they have workspace permissions', async () => {
      const { user: owner, workspace: ownerWs } = await createWorkspaceWithOwner();
      const { user: assignee } = await createWorkspaceWithOwner();
      
      const task = await createTask(ownerWs.id, owner.id, { title: 'Assigned Task' });
      
      // Make the assignee a member of the workspace with ADMIN role to allow editing
      await prisma.workspaceMember.create({
        data: { 
          userId: assignee.id, 
          workspaceId: ownerWs.id, 
          role: 'ADMIN' 
        },
      });
      
      // Also assign them to the task for completeness
      await prisma.taskAssignee.create({
        data: { taskId: task.id, userId: assignee.id }
      });
      
      const headers = await authWithCsrfHeaders(assignee);
      
      const res = await request(app)
        .put(`/api/v1/tasks/${task.id}`)
        .set(headers)
        .send({ title: 'Updated by Admin Assignee' });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Infrastructure Security', () => {
    describe('CSRF Protection', () => {
      it('should block mutations when the x-csrf-token header is missing', async () => {
        const { user, workspace } = await createWorkspaceWithOwner();
        const project = await prisma.project.create({
          data: {
            name: 'CSRF Test Project',
            slug: 'csrf-test',
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            createdById: user.id,
          }
        });

        const { Authorization } = await authWithCsrfHeaders(user);
        
        const res = await request(app)
          .patch(`/api/v1/projects/${project.id}`)
          .set('Authorization', Authorization)
          .send({ name: 'Attempting bypass' });
        
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CSRF_VALIDATION_FAILED');
      });

      it('should block mutations when the x-csrf-token is invalid', async () => {
        const { user, workspace } = await createWorkspaceWithOwner();
        const project = await prisma.project.create({
          data: {
            name: 'CSRF Invalid Test',
            slug: 'csrf-invalid',
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            createdById: user.id,
          }
        });

        const { Authorization } = await authWithCsrfHeaders(user);
        
        const res = await request(app)
          .patch(`/api/v1/projects/${project.id}`)
          .set('Authorization', Authorization)
          .set('x-csrf-token', 'invalid-token-123')
          .send({ name: 'Invalid token attempt' });
        
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CSRF_VALIDATION_FAILED');
      });

      it('should allow mutations when a valid x-csrf-token is provided', async () => {
        const { user, workspace } = await createWorkspaceWithOwner();
        const project = await prisma.project.create({
          data: {
            name: 'CSRF Valid Test',
            slug: 'csrf-valid',
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            createdById: user.id,
          }
        });

        const headers = await authWithCsrfHeaders(user);
        
        const res = await request(app)
          .patch(`/api/v1/projects/${project.id}`)
          .set(headers)
          .send({ name: 'Valid token update' });
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe('Rate Limiting', () => {
      it('should return 429 when the route-specific rate limit is exceeded', async () => {
        const { user } = await createWorkspaceWithOwner();
        const headers = await authWithCsrfHeaders(user);
        const testIp = '1.2.3.4';

        // Mock Redis pipeline.exec to return a count that exceeds the limit (5)
        // The middleware expects results[2] to be the zcard result.
        const redis = getRedisClient();
        const spy = vi.spyOn(redis, 'pipeline').mockReturnValue({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([
            [null, 'OK'],        // zremrangebyscore
            [null, 'OK'],        // zadd
            [null, 10],          // zcard (count = 10, limit = 5)
            [null, 'OK'],        // expire
          ]),
        } as any);

        const res = await request(app)
          .post('/api/v1/templates')
          .set(headers)
          .set('X-Forwarded-For', testIp)
          .send({ email: 'rate-limit-test@example.com' });
        
        expect(res.status).toBe(429);
        expect(res.body.message).toBe('Too many requests');

        spy.mockRestore();
      });

      it('PUT /api/v1/user/profile — 429 when the per-user limit is exceeded', async () => {
        const { user } = await createWorkspaceWithOwner();
        const headers = await authWithCsrfHeaders(user);

        // Mock Redis pipeline.exec to return a count (21) that exceeds the
        // PUT /profile limit (20/60s). The middleware expects results[2] to be
        // the zcard result.
        const redis = getRedisClient();
        const spy = vi.spyOn(redis, 'pipeline').mockReturnValue({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([
            [null, 'OK'],
            [null, 'OK'],
            [null, 21],          // zcard (count = 21, limit = 20)
            [null, 'OK'],
          ]),
        } as any);

        const res = await request(app)
          .put('/api/v1/user/profile')
          .set(headers)
          .send({ name: 'Rate Limited' });

        expect(res.status).toBe(429);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(res.body.retryAfter).toBe(60);

        spy.mockRestore();
      });

      it('PUT /api/v1/user/profile — bucket is keyed off the user id (per-user, not per-IP)', async () => {
        const { user } = await createWorkspaceWithOwner();
        const headers = await authWithCsrfHeaders(user);

        const redis = getRedisClient();
        const spy = vi.spyOn(redis, 'pipeline').mockReturnValue({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([
            [null, 'OK'],
            [null, 'OK'],
            [null, 1],
            [null, 'OK'],
          ]),
        } as any);

        const res = await request(app)
          .put('/api/v1/user/profile')
          .set(headers)
          .send({ name: 'Keyed By User' });

        // Under the limit → request passes through; the bucket key must be the
        // authenticated user id, never the (spoofable) client IP.
        expect(res.status).toBe(200);
        const zaddKey = (spy.mock.results[0].value.zadd as any).mock.calls[0][0];
        expect(zaddKey).toBe(`rl:user:${user.id}`);

        spy.mockRestore();
      });

      it('GET /api/v1/user/profile — 429 when the per-user limit is exceeded', async () => {
        const { user } = await createWorkspaceWithOwner();
        const headers = authHeaders(user);

        // Count (61) exceeds the GET /profile read limit (60/60s).
        const redis = getRedisClient();
        const spy = vi.spyOn(redis, 'pipeline').mockReturnValue({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([
            [null, 'OK'],
            [null, 'OK'],
            [null, 61],
            [null, 'OK'],
          ]),
        } as any);

        const res = await request(app)
          .get('/api/v1/user/profile')
          .set(headers);

        expect(res.status).toBe(429);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');

        spy.mockRestore();
      });
    });

    describe('Payload Robustness', () => {
      it('should return 400 for excessively large JSON payloads', async () => {
        const { user } = await createWorkspaceWithOwner();
        const { Authorization } = await authWithCsrfHeaders(user);
        
        const largeData = 'A'.repeat(11 * 1024 * 1024);
        
        const res = await request(app)
          .post('/api/v1/tasks')
          .set('Authorization', Authorization)
          .send({ title: largeData });
        
        expect(res.status).toBe(413);
      });

      it('should return 400 for malformed JSON', async () => {
        const { user } = await createWorkspaceWithOwner();
        const { Authorization } = await authWithCsrfHeaders(user);
        
        const res = await request(app)
          .post('/api/v1/tasks')
          .set('Authorization', Authorization)
          .set('Content-Type', 'application/json')
          .send('{"title": "Missing closing brace"'); 
        
        expect(res.status).toBe(400);
      });
    });
  });
});
