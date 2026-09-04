import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace, cleanAllTestData } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';
import { WorkspaceRole } from '@prisma/client';

vi.mock('cloudinary', () => {
  const v2: any = {
    config: vi.fn(),
    uploader: {
      upload: vi.fn().mockResolvedValue({
        secure_url: 'https://cloudinary.com/test.pdf',
        public_id: 'gablura/files/test_file',
        format: 'pdf',
        bytes: 2048,
        thumbnail_url: null,
      }),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  };
  v2.v2 = v2;
  return { v2 };
});

describe('Upload Module Integration Tests', () => {
  let owner: any;
  let member: any;
  let workspace: any;

  beforeEach(async () => {
    await cleanAllTestData();
    const setup = await createWorkspaceWithOwner();
    owner = setup.user;
    workspace = setup.workspace;

    const memberUser = await createUser();
    await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
    member = memberUser;
  });

  describe('POST /api/v1/upload', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .attach('file', Buffer.from('test content'), { filename: 'test.txt', contentType: 'text/plain' });

      expect(res.status).toBe(401);
    });

    it('should return 400 when no file is provided', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(owner))
        .field('uploadType', 'profile');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No file');
    });

    it('should upload a profile picture', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(owner))
        .field('uploadType', 'profile')
        .attach('file', Buffer.from('fake image data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBeDefined();
      expect(res.body.message).toContain('Profile');
    });

    it('should upload a workspace file', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(owner))
        .field('workspaceId', workspace.id)
        .attach('file', Buffer.from('file content here'), {
          filename: 'document.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file).toBeDefined();
      expect(res.body.storageInfo).toBeDefined();
    });

    it('should return 400 when workspaceId is missing for workspace upload', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(owner))
        .attach('file', Buffer.from('content'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Workspace ID');
    });

    it('should return 400 for invalid workspaceId format', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(owner))
        .field('workspaceId', 'invalid-id')
        .attach('file', Buffer.from('content'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid');
    });

    it('member can upload files to workspace', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set(await authWithCsrfHeaders(member))
        .field('workspaceId', workspace.id)
        .attach('file', Buffer.from('member file'), {
          filename: 'member-doc.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
