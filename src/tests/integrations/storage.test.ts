import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace, cleanAllTestData } from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';
import { WorkspaceRole } from '@prisma/client';

describe('Storage Module Integration Tests', () => {
  let admin: any;
  let member: any;
  let workspace: any;
  let BASE: string = '';

  beforeEach(async () => {
    // Clean up
    await cleanAllTestData();

    const ownerData = await createWorkspaceWithOwner();
    admin = ownerData.user;
    workspace = ownerData.workspace;
    BASE = `/api/v1/storage`;

    // Create a regular member
    const memberUser = await createUser();
    await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
    member = memberUser;
  });

  describe('GET /workspaces', () => {
    it('returns storage summary for all joined workspaces', async () => {
      await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024 * 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/workspaces`)
        .set(await authWithCsrfHeaders(admin));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data[0].workspaceId).toBe(workspace.id);
    });
  });

  describe('GET /:workspaceId/info', () => {
    it('returns workspace storage info', async () => {
      const res = await request(app)
        .get(`${BASE}/${workspace.id}/info`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('usedMB');
      expect(res.body.data).toHaveProperty('totalMB');
    });

    it('returns 403 if user is not a member', async () => {
      const stranger = await createUser();
      const res = await request(app)
        .get(`${BASE}/${workspace.id}/info`)
        .set(await authWithCsrfHeaders(stranger));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:workspaceId/overview', () => {
    it('returns full storage overview for members', async () => {
      const res = await request(app)
        .get(`${BASE}/${workspace.id}/overview`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('storageInfo');
      expect(res.body.data).toHaveProperty('breakdown');
      expect(res.body.data).toHaveProperty('largestFiles');
    });
  });

  describe('GET /:workspaceId/my-contribution', () => {
    it('returns correct contribution for the user', async () => {
      await prisma.file.create({
        data: {
          name: 'my-file.txt',
          originalName: 'my-file.txt',
          size: 5 * 1024 * 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/my-file.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/my-contribution`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.usageMB).toBe(5);
    });
  });

  describe('GET /:workspaceId/user-contributions', () => {
    it('allows admin to see all user contributions', async () => {
      await prisma.file.create({
        data: {
          name: 'file1.txt',
          originalName: 'file1.txt',
          size: 1024 * 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/file1.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/user-contributions`)
        .set(await authWithCsrfHeaders(admin));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data[0].userId).toBe(member.id);
    });

    it('denies members from seeing user contributions', async () => {
      const res = await request(app)
        .get(`${BASE}/${workspace.id}/user-contributions`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:workspaceId/largest-files', () => {
    it('returns list of largest files', async () => {
      await prisma.file.create({
        data: {
          name: 'big.zip',
          originalName: 'big.zip',
          size: 10 * 1024 * 1024,
          mimeType: 'application/zip',
          url: 'http://example.com/big.zip',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/largest-files`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].name).toBe('big.zip');
    });
  });

  describe('POST /:workspaceId/check-upload', () => {
    it('returns allowed=true for small files', async () => {
      const res = await request(app)
        .post(`${BASE}/${workspace.id}/check-upload`)
        .set(await authWithCsrfHeaders(member))
        .send({ fileSize: 1024 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns allowed=false for files exceeding plan limit', async () => {
      const res = await request(app)
        .post(`${BASE}/${workspace.id}/check-upload`)
        .set(await authWithCsrfHeaders(member))
        .send({ fileSize: 1000 * 1024 * 1024 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('exceeds');
    });
  });

  describe('POST /:workspaceId/bulk-delete', () => {
    it('allows admin to bulk delete files', async () => {
      const f1 = await prisma.file.create({
        data: {
          name: 'f1.txt',
          originalName: 'f1.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/f1.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });
      const f2 = await prisma.file.create({
        data: {
          name: 'f2.txt',
          originalName: 'f2.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/f2.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });

      const res = await request(app)
        .post(`${BASE}/${workspace.id}/bulk-delete`)
        .set(await authWithCsrfHeaders(admin))
        .send({ fileIds: [f1.id, f2.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deletedCount).toBe(2);

      const remaining = await prisma.file.findMany({ where: { workspaceId: workspace.id } });
      expect(remaining).toHaveLength(0);
    });
  });

  describe('DELETE /files/:fileId', () => {
    it('allows owner to delete their own file', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'my-file.txt',
          originalName: 'my-file.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/my-file.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });

      const res = await request(app)
        .delete(`${BASE}/files/${file.id}`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deletedFile = await prisma.file.findUnique({ where: { id: file.id } });
      expect(deletedFile).toBeNull();
    });

    it('denies non-owner from deleting another users file', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'other-file.txt',
          originalName: 'other-file.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/other-file.txt',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .delete(`${BASE}/files/${file.id}`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(403);
    });
  });
});
