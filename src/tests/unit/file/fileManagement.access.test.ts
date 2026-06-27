// src/tests/unit/file/fileManagement.access.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for fileManagement.access.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FileManagementAccess } from '../../../modules/file/fileManagement.access.js';
import { ForbiddenError } from '../../../errors/index.js';
import { createWorkspaceWithOwner, createUser, addMemberToWorkspace } from '../../../tests/factories/index.js';

describe('FileManagementAccess', () => {
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
    await addMemberToWorkspace(memberUser.id, workspace.id);
  });

  describe('assertWorkspaceMember', () => {
    it('resolves if user is a member', async () => {
      await expect(FileManagementAccess.assertWorkspaceMember(user.id, workspace.id)).resolves.toBeDefined();
      await expect(FileManagementAccess.assertWorkspaceMember(admin.id, workspace.id)).resolves.toBeDefined();
    });

    it('throws ForbiddenError if user is not a member', async () => {
      const stranger = await createUser();
      await expect(FileManagementAccess.assertWorkspaceMember(stranger.id, workspace.id)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('isWorkspaceAdmin', () => {
    it('returns true if user is OWNER', async () => {
      const isAdmin = await FileManagementAccess.isWorkspaceAdmin(user.id, workspace.id);
      expect(isAdmin).toBe(true);
    });

    it('returns true if user is ADMIN', async () => {
      // We need to manually set a role to ADMIN for a member
      const adminUser = await createUser();
      await addMemberToWorkspace(adminUser.id, workspace.id, (require('@prisma/client').WorkspaceRole).ADMIN);
      
      const isAdmin = await FileManagementAccess.isWorkspaceAdmin(adminUser.id, workspace.id);
      expect(isAdmin).toBe(true);
    });

    it('returns false if user is MEMBER', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, (require('@prisma/client').WorkspaceRole).MEMBER);
      
      const isAdmin = await FileManagementAccess.isWorkspaceAdmin(memberUser.id, workspace.id);
      expect(isAdmin).toBe(false);
    });

    it('returns false if user is not in workspace', async () => {
      const stranger = await createUser();
      const isAdmin = await FileManagementAccess.isWorkspaceAdmin(stranger.id, workspace.id);
      expect(isAdmin).toBe(false);
    });
  });
});
