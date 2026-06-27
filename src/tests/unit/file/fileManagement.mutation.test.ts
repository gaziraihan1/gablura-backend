// src/tests/unit/file/fileManagement.mutation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for fileManagement.mutation.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FileManagementMutation } from '../../../modules/file/fileManagement.mutation.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace } from '../../../tests/factories/index.js';
import { NotFoundError, ForbiddenError } from '../../../errors/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('FileManagementMutation', () => {
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

  describe('deleteFile', () => {
    it('allows admin to delete any file in the workspace', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: user.id, // uploaded by owner (admin)
        },
      });

      await FileManagementMutation.deleteFile(file.id, workspace.id, admin.id);
      
      const deletedFile = await prisma.file.findUnique({ where: { id: file.id } });
      expect(deletedFile).toBeNull();
    });

    it('allows user to delete their own file', async () => {
      const file = await prisma.file.create({
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

      await FileManagementMutation.deleteFile(file.id, workspace.id, user.id);
      
      const deletedFile = await prisma.file.findUnique({ where: { id: file.id } });
      expect(deletedFile).toBeNull();
    });

    it('throws NotFoundError if file does not exist', async () => {
      await expect(
        FileManagementMutation.deleteFile('non-existent-id', workspace.id, admin.id)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError if file is in a different workspace', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: { name: 'Other WS', slug: 'other-ws', ownerId: user.id }
      });
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: otherWorkspace.id,
          uploadedById: user.id,
        },
      });

      await expect(
        FileManagementMutation.deleteFile(file.id, workspace.id, admin.id)
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError if member tries to delete someone else's file", async () => {
      const file = await prisma.file.create({
        data: {
          name: 'test.txt',
          originalName: 'test.txt',
          size: 1024,
          mimeType: 'text/plain',
          url: 'http://example.com/test.txt',
          workspaceId: workspace.id,
          uploadedById: admin.id, // uploaded by admin
        },
      });

      // memberUser was created in beforeEach
      const memberUser = await prisma.workspaceMember.findFirst({ where: { workspaceId: workspace.id, role: 'MEMBER' } });
      // We need to find the user ID from the membership
      const membership = await prisma.workspaceMember.findFirst({ where: { workspaceId: workspace.id, role: 'MEMBER' } });
      // Actually, let's just create a new one for simplicity in this test case
      const memberUser2 = await createUser();
      await addMemberToWorkspace(memberUser2.id, workspace.id, (require('@prisma/client').WorkspaceRole).MEMBER);

      await expect(
        FileManagementMutation.deleteFile(file.id, workspace.id, memberUser2.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
