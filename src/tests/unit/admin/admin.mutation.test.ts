// src/tests/admin/admin.unit.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the admin query + mutation layer.
// These tests hit the real DB (test instance) but bypass HTTP entirely —
// they call the imported functions directly so failures are pinpointed to
// the data layer, not routing/middleware.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { WorkspacePlan } from '@prisma/client';

vi.mock('../../../lib/redis/cache.client.js', () => ({
  UserCache: {
    invalidateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Factories ────────────────────────────────────────────────────────────────
import {
  createUser,
  createAdminUser,
  createWorkspaceWithOwner,
  
} from '../../factories/index.js';

// ── Mutations under test ─────────────────────────────────────────────────────
import {
  mutateUpdateWorkspaceLimits,
  mutateSoftDeleteWorkspace,
  mutateHardDeleteWorkspace,
  mutateRestoreWorkspace,
  mutateBanUser,
  mutateUnbanUser,
} from '../../../admin/admin.mutation.js';

import { UserCache } from '../../../lib/redis/cache.client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Workspace mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('mutateUpdateWorkspaceLimits', () => {
  it('updates plan, maxMembers, and maxStorage and returns the correct shape', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const result = await mutateUpdateWorkspaceLimits(workspace.id, {
      plan:       WorkspacePlan.BUSINESS,
      maxMembers: 50,
      maxStorage: 10_000,
    });

    expect(result.id).toBe(workspace.id);
    expect(result.plan).toBe(WorkspacePlan.BUSINESS);
    expect(result.maxMembers).toBe(50);
    expect(result.maxStorage).toBe(10_000);
    // Shape check — only selected fields returned
    expect(result).toHaveProperty('slug');
    expect(result).toHaveProperty('name');
    expect((result as any).ownerId).toBeUndefined();
  });

  it('accepts -1 as unlimited for maxMembers and maxStorage', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const result = await mutateUpdateWorkspaceLimits(workspace.id, {
      plan:       WorkspacePlan.PRO,
      maxMembers: -1,
      maxStorage: -1,
    });

    expect(result.maxMembers).toBe(-1);
    expect(result.maxStorage).toBe(-1);
  });

  it('persists changes to the database', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    await mutateUpdateWorkspaceLimits(workspace.id, {
      plan:       WorkspacePlan.BUSINESS,
      maxMembers: 100,
      maxStorage: 50_000,
    });

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.plan).toBe(WorkspacePlan.BUSINESS);
    expect(fresh?.maxMembers).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('mutateSoftDeleteWorkspace', () => {
  it('sets deletedAt, deletedById, and deleteReason on the workspace', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await mutateSoftDeleteWorkspace(workspace.id, admin.id, 'Violates ToS');

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.deletedAt).toBeInstanceOf(Date);
    expect(fresh?.deletedById).toBe(admin.id);
    expect(fresh?.deleteReason).toBe('Violates ToS');
  });

  it('returns ownerEmail, ownerName, and workspaceName', async () => {
    const admin = await createAdminUser();
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await mutateSoftDeleteWorkspace(workspace.id, admin.id);

    expect(result.ownerEmail).toBe(user.email);
    expect(result.workspaceName).toBe(workspace.name);
    expect(typeof result.ownerName).toBe('string');
  });

  it('uses null for deleteReason when not provided', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await mutateSoftDeleteWorkspace(workspace.id, admin.id);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.deleteReason).toBeNull();
  });

  it('falls back to "User" when owner name is null', async () => {
    const admin = await createAdminUser();
    // Create a user whose name could be blank — name is required in factory
    // so we patch directly after creation
    const { user, workspace } = await createWorkspaceWithOwner();
    await prisma.user.update({ where: { id: user.id }, data: { name: null } });

    const result = await mutateSoftDeleteWorkspace(workspace.id, admin.id);

    expect(result.ownerName).toBe('User');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('mutateHardDeleteWorkspace', () => {
  it('permanently removes the workspace from the database', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    await mutateHardDeleteWorkspace(workspace.id);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh).toBeNull();
  });

  it('returns owner info before deletion', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await mutateHardDeleteWorkspace(workspace.id);

    expect(result.ownerEmail).toBe(user.email);
    expect(result.workspaceName).toBe(workspace.name);
  });

  it('throws NOT_FOUND when workspace does not exist', async () => {
    await expect(
      mutateHardDeleteWorkspace('non-existent-id')
    ).rejects.toThrow('NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('mutateRestoreWorkspace', () => {
  it('clears deletedAt, deletedById, and deleteReason', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    // First soft-delete it
    await mutateSoftDeleteWorkspace(workspace.id, admin.id, 'Test reason');

    // Then restore
    await mutateRestoreWorkspace(workspace.id);

    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.deletedAt).toBeNull();
    expect(fresh?.deletedById).toBeNull();
    expect(fresh?.deleteReason).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// User mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('mutateBanUser', () => {
  it('sets bannedAt, banReason, and bannedById on the target user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await mutateBanUser(user.id, admin.id, 'Spam activity');

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fresh?.bannedAt).toBeInstanceOf(Date);
    expect(fresh?.banReason).toBe('Spam activity');
    expect(fresh?.bannedById).toBe(admin.id);
    
    expect(UserCache.invalidateProfile).toHaveBeenCalledWith(user.id);
  });

  it('does not affect other users', async () => {

    const admin     = await createAdminUser();
    const target    = await createUser();
    const bystander = await createUser();

    await mutateBanUser(target.id, admin.id, 'Reason');

    const fresh = await prisma.user.findUnique({ where: { id: bystander.id } });
    expect(fresh?.bannedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('mutateUnbanUser', () => {
  it('clears bannedAt, banReason, and bannedById', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await mutateBanUser(user.id, admin.id, 'Initial ban');
    await mutateUnbanUser(user.id);

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fresh?.bannedAt).toBeNull();
    expect(fresh?.banReason).toBeNull();
    expect(fresh?.bannedById).toBeNull();
    
    expect(UserCache.invalidateProfile).toHaveBeenCalledWith(user.id);
  });

  it('is idempotent — unbanning an already-unbanned user does not throw', async () => {

    const user = await createUser();
    await expect(mutateUnbanUser(user.id)).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema validation (no DB needed)
// ─────────────────────────────────────────────────────────────────────────────

import {
  paginationSchema,
  updateWorkspaceLimitsSchema,
  banUserSchema,
  deleteWorkspaceSchema,
} from '../../../admin/admin.validation.js';

describe('paginationSchema', () => {
  it('applies defaults when called with an empty object', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('coerces string numbers', () => {
    const result = paginationSchema.parse({ page: '3', pageSize: '10' });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it('rejects page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects pageSize > 100', () => {
    expect(() => paginationSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('accepts optional search and workspaceId', () => {
    const result = paginationSchema.parse({ search: 'acme', workspaceId: 'ws-123' });
    expect(result.search).toBe('acme');
    expect(result.workspaceId).toBe('ws-123');
  });
});

describe('updateWorkspaceLimitsSchema', () => {
  it('parses valid input', () => {
    const result = updateWorkspaceLimitsSchema.parse({
      plan: 'PRO',
      maxMembers: 25,
      maxStorage: 5000,
    });
    expect(result.plan).toBe('PRO');
  });

  it('accepts -1 for unlimited fields', () => {
    const result = updateWorkspaceLimitsSchema.parse({
      plan: 'FREE',
      maxMembers: -1,
      maxStorage: -1,
    });
    expect(result.maxMembers).toBe(-1);
    expect(result.maxStorage).toBe(-1);
  });

  it('rejects maxMembers of 0', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'PRO', maxMembers: 0, maxStorage: 100 })
    ).toThrow('maxMembers');
  });

  it('rejects maxStorage of 0', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'PRO', maxMembers: 5, maxStorage: 0 })
    ).toThrow('maxStorage');
  });

  it('rejects invalid plan enum', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'BUSINESS', maxMembers: 5, maxStorages: 50 })
    ).toThrow();
  });
});

describe('banUserSchema', () => {
  it('parses a valid reason', () => {
    const result = banUserSchema.parse({ reason: 'Violates ToS' });
    expect(result.reason).toBe('Violates ToS');
  });

  it('rejects an empty reason', () => {
    expect(() => banUserSchema.parse({ reason: '' })).toThrow('Reason is required');
  });

  it('rejects a reason longer than 500 chars', () => {
    expect(() => banUserSchema.parse({ reason: 'a'.repeat(501) })).toThrow();
  });
});

describe('deleteWorkspaceSchema', () => {
  it('defaults hardDelete to false', () => {
    const result = deleteWorkspaceSchema.parse({});
    expect(result.hardDelete).toBe(false);
  });

  it('accepts hardDelete: true', () => {
    const result = deleteWorkspaceSchema.parse({ hardDelete: true });
    expect(result.hardDelete).toBe(true);
  });

  it('accepts an optional reason up to 500 chars', () => {
    const result = deleteWorkspaceSchema.parse({ reason: 'Policy violation' });
    expect(result.reason).toBe('Policy violation');
  });

  it('rejects a reason over 500 chars', () => {
    expect(() =>
      deleteWorkspaceSchema.parse({ reason: 'x'.repeat(501) })
    ).toThrow();
  });
});