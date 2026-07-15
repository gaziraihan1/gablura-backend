// src/tests/unit/file/fileManagement.filters.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for fileManagement.filters.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { buildFileWhereClause, buildFileOrderBy } from '../../../modules/file/fileManagement.filters.js';
import { createUser, createWorkspaceWithOwner, addMemberToWorkspace, cleanAllTestData } from '../../../tests/factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('fileManagement.filters', () => {
  let user: any;
  let admin: any;
  let workspace: any;

  beforeEach(async () => {
    // Clean up and setup
    await cleanAllTestData();

    const ownerData = await createWorkspaceWithOwner();
    user = ownerData.user;
    workspace = ownerData.workspace;
    admin = user; // Owner is admin

    // We need a second user to be a member
    const memberUser = await createUser();
    await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
  });

  describe('buildFileWhereClause', () => {
    it('returns basic where clause with workspaceId', () => {
      const where = buildFileWhereClause(workspace.id, true, admin.id);
      expect(where.workspaceId).toBe(workspace.id);
    });

    it('includes uploadedById if not admin', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);

      const where = buildFileWhereClause(workspace.id, false, memberUser.id);
      expect(where.workspaceId).toBe(workspace.id);
      expect(where.uploadedById).toBe(memberUser.id);
    });

    it('excludes uploadedById if admin', () => {
      const where = buildFileWhereClause(workspace.id, true, admin.id);
      expect(where.workspaceId).toBe(workspace.id);
      expect(where.uploadedById).toBeUndefined();
    });

    it('adds search filter', () => {
      const filters = { search: 'test' };
      const where = buildFileWhereClause(workspace.id, true, admin.id, filters);
      expect(where.OR).toContainEqual(expect.objectContaining({ originalName: { contains: 'test', mode: 'insensitive' } }));
      expect(where.OR).toContainEqual(expect.objectContaining({ name: { contains: 'test', mode: 'insensitive' } }));
    });

    it('adds fileType filter', () => {
      const filters = { fileType: 'images' };
      const where = buildFileWhereClause(workspace.id, true, admin.id, filters);
      // Note: FILE_TYPE_MAP is internal to fileManagement.types.ts, 
      // but we know images contains 'image/jpeg' etc.
      expect(where.mimeType).toBeDefined();
      expect(where.mimeType.in).toContain('image/jpeg');
    });

    it('adds uploadedBy filter (for admins only)', async () => {
      const memberUser = await createUser();
      await addMemberToWorkspace(memberUser.id, workspace.id, WorkspaceRole.MEMBER);
      
      const filters = { uploadedBy: memberUser.id };
      const where = buildFileWhereClause(workspace.id, true, admin.id, filters);
      expect(where.uploadedById).toBe(memberUser.id);
    });

    it('adds date filters', async () => {
      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-12-31');
      const filters = { dateFrom, dateTo };
      const where = buildFileWhereClause(workspace.id, true, admin.id, filters);
      expect(where.uploadedAt.gte).toBe(dateFrom);
      expect(where.uploadedAt.lte).toBe(dateTo);
    });
  });

  describe('buildFileOrderBy', () => {
    it('returns default orderBy if no filters provided', () => {
      const orderBy = buildFileOrderBy();
      expect(orderBy).toEqual({ uploadedAt: 'desc' });
    });

    it('returns custom orderBy based on sortBy and sortOrder', () => {
    
      const filters = { sortBy: 'name', sortOrder: 'asc' } as const;
      const orderBy = buildFileOrderBy(filters);
      expect(orderBy).toEqual({ originalName: 'asc' });

      const filters2 = { sortBy: 'size', sortOrder: 'desc' } as const;
      const orderBy2 = buildFileOrderBy(filters2);
      expect(orderBy2).toEqual({ size: 'desc' });

      const filters3 = { sortBy: 'date', sortOrder: 'asc' } as const;
      const orderBy3 = buildFileOrderBy(filters3);
      expect(orderBy3).toEqual({ uploadedAt: 'asc' });
    });
  });
});
