// src/tests/integrations/file/fileManagement.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for fileManagement.routes.ts using the real app and test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace, cleanAllTestData } from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';
import { WorkspaceRole } from '@prisma/client';

describe('File Management API', () => {
  let admin: any;
  let member: any;
  let workspace: any;
  let BASE: string = '';

  beforeEach(async () => {
    // Clean up and setup
    await cleanAllTestData();

    const ownerData = await createWorkspaceWithOwner();
    admin = ownerData.user;
    workspace = ownerData.workspace;
    BASE = `/api/v1/file-management/${workspace.id}`;

    // Create a regular member
    const memberUser = await createUser();
    await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
    member = memberUser;
  });


  describe('GET /files', () => {
    it('returns 200 and list of files for a workspace member', async () => {
      await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: member.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/files`)
        .set(authHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.files).toHaveLength(1);
      expect(res.body.data.files[0].name).toBe('test.txt');
    });

    it('returns 401 if not authenticated', async () => {
      const res = await request(app).get(`${BASE}/files`);
      expect(res.status).toBe(401);
    });

    it('returns 403 if user is not in the workspace', async () => {
      const stranger = await createUser();
      const res = await request(app)
        .get(`${BASE}/files`)
        .set(authHeaders(stranger));
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /files/:fileId', () => {
    it('allows admin to delete a file', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .delete(`${BASE}/files/${file.id}`)
        .set(await authWithCsrfHeaders(admin));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('File deleted successfully');

      const deletedFile = await prisma.file.findUnique({ where: { id: file.id } });
      expect(deletedFile).toBeNull();
    });

    it('allows owner of file to delete it', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
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

    it('denies non-owner member from deleting someone else\'s file', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .delete(`${BASE}/files/${file.id}`)
        .set(await authWithCsrfHeaders(member));

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent file', async () => {
      const res = await request(app)
        .delete(`${BASE}/files/non-existent-id`)
        .set(await authWithCsrfHeaders(admin));

      expect(res.status).toBe(404);
    });
  });

  describe('GET /stats', () => {
    it('returns stats for a workspace member', async () => {
      await prisma.file.create({
        data: {
          name: 'image.png',
          originalName: 'image.png',
          size: 1024,
          mimeType: 'image/png',
          url: 'http://example.com/image.png',
          workspaceId: workspace.id,
          uploadedById: admin.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/stats`)
        .set(authHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /uploaders', () => {
    it('returns uploaders for an admin', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);

      await prisma.file.create({
        data: {
          name: 'file1.txt',
          originalName: 'file1.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/file1.txt',
          workspaceId: workspace.id,
          uploadedById: memberUser.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/uploaders`)
        .set(authHeaders(admin));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(memberUser.id);
    });

    it('returns empty array for non-admins', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);

      await prisma.file.create({
        data: {
          name: 'file1.txt',
          originalName: 'file1.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/file1.txt',
          workspaceId: workspace.id,
          uploadedById: memberUser.id,
        },
      });

      const res = await request(app)
        .get(`${BASE}/uploaders`)
        .set(authHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
