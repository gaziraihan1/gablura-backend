// src/tests/unit/file/fileManagement.query.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for fileManagement.query.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FileManagementQuery } from '../../../modules/file/fileManagement.query.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace } from '../../../tests/factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('FileManagementQuery', () => {
  let user: any;
  let admin: any;
  let workspace: any;

  beforeEach(async () => {
    // Clean up and setup
    await prisma.file.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();

    const ownerData = await createWorkspaceWithOwner();
    user = ownerData.user;
    workspace = ownerData.workspace;
    admin = user; // Owner is admin

    // Create a regular member
    const memberUser = await createUser();
    await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
  });

  describe('getFiles', () => {
    it('returns files for the workspace', async () => {
      await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });

      const result = await FileManagementQuery.getFiles(workspace.id, user.id);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('test.txt');
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.isAdmin).toBe(true);
    });

    it('applies search filter', async () => {
      await prisma.file.create({
        data: {
          name: 'apple.txt',
          originalName: 'apple.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/apple.txt',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });
      await prisma.file.create({
        data: {
          name: 'banana.txt',
          originalName: 'banana.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/banana.txt',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });

      const result = await FileManagementQuery.getFiles(workspace.id, user.id, { search: 'apple' });
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('apple.txt');
    });

    it('applies fileType filter', async () => {
      await prisma.file.create({
        data: {
          name: 'image.png',
          originalName: 'image.png',
          size: 1024,
          mimeType: 'image/png',
          url: 'http://example.com/image.png',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });
      await prisma.file.create({
        data: {
          name: 'doc.pdf',
          originalName: 'doc.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          url: 'http://example.com/doc.pdf',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });

      const result = await FileManagementQuery.getFiles(workspace.id, user.id, { fileType: 'images' });
      expect(result.files).toHaveLength(1);
      expect(result.files[0].mimeType).toBe('image/png');
    });

    it('handles pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.file.create({
          data: {
            name: `file${i}.txt`,
            originalName: `file${i}.txt`,
            size: 1024,
            mimeType: 'text/plain',
            url: `http://example.com/file${i}.txt`,
            workspaceId: workspace.id,
            uploadedById: user.id,
          },
        });
      }

      const result = await FileManagementQuery.getFiles(workspace.id, user.id, undefined, 1, 2);
      expect(result.files).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('respects sorting', async () => {
      await prisma.file.create({
        data: {
          name: 'b.txt',
          originalName: 'b.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/b.txt',
          workspaceId: workspace.id,
          uploadedById: user.id,
          uploadedAt: new Date('2023-01-01'),
        },
      });
      await prisma.file.create({
        data: {
          name: 'a.txt',
          originalName: 'a.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/a.txt',
          workspaceId: workspace.id,
          uploadedById: user.id,
          uploadedAt: new Date('2023-01-02'),
        },
      });

      const result = await FileManagementQuery.getFiles(workspace.id, user.id, { sortBy: 'name', sortOrder: 'asc' });
      expect(result.files[0].name).toBe('a.txt');
      expect(result.files[1].name).toBe('b.txt');
    });
  });

  describe('getFileTypeStats', () => {
    it('returns stats for all files in the workspace for an admin', async () => {
      await prisma.file.create({
        data: {
          name: 'image.png',
          originalName: 'image.png',
          size: 1024,
          mimeType: 'image/png',
          url: 'http://example.com/image.png',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });
      await prisma.file.create({
        data: {
          name: 'doc.pdf',
          originalName: 'doc.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          url: 'http://example.com/doc.pdf',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });

      const stats = await FileManagementQuery.getFileTypeStats(workspace.id, user.id);
      
      const imageStats = stats.find(s => s.type === 'Images');
      const pdfStats = stats.find(s => s.type === 'PDFs');
      
      expect(imageStats?.count).toBe(1);
      expect(imageStats?.sizeMB).toBe(0); // 1024 bytes is 0 MB rounded
      expect(pdfStats?.count).toBe(1);
      expect(pdfStats?.sizeMB).toBe(0);
    });

    it('returns only stats for files uploaded by the user if not admin', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);

      await prisma.file.create({
        data: {
          name: 'my-image.png',
          originalName: 'my-image.png',
          size: 1024,
          mimeType: 'image/png',
          url: 'http://example.com/my-image.png',
          workspaceId: workspace.id,
          uploadedById: memberUser.id,
        },
      });
      await prisma.file.create({
        data: {
          name: 'admin-doc.pdf',
          originalName: 'admin-doc.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          url: 'http://example.com/admin-doc.pdf',
          workspaceId: workspace.id,
          uploadedById: user.id,
        },
      });

      const stats = await FileManagementQuery.getFileTypeStats(workspace.id, memberUser.id);
      
      expect(stats).toHaveLength(1);
      expect(stats[0].type).toBe('Images');
    });
  });

  describe('getUploaders', () => {
    it('returns uploaders for admins', async () => {
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

      const uploaders = await FileManagementQuery.getUploaders(workspace.id, user.id);
      expect(uploaders).toHaveLength(1);
      expect(uploaders[0].id).toBe(memberUser.id);
      expect(uploaders[0].fileCount).toBe(1);
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

      const uploaders = await FileManagementQuery.getUploaders(workspace.id, memberUser.id);
      expect(uploaders).toHaveLength(0);
    });
  });
});
