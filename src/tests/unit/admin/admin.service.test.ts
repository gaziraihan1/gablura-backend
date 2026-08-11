// src/tests/unit/admin/admin.service.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the admin service layer — specifically that workspace-limit
// updates (including AI overrides) are written to the Activity feed as an
// audit trail attributed to the acting Focura admin.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { WorkspacePlan } from '@prisma/client';

vi.mock('../../../queue/index.js', () => ({
  addSendNotificationJob: vi.fn().mockResolvedValue(undefined),
  addSendEmailJob:        vi.fn().mockResolvedValue(undefined),
  addInvalidateCacheJob:  vi.fn().mockResolvedValue(undefined),
}));

import {
  serviceUpdateWorkspaceLimits,
  buildLimitChangeSummary,
  formatLimitChangeValue,
} from '../../../admin/admin.service.js';
import { ActivityMutation } from '../../../modules/activity/activity.mutation.js';
import {
  addSendNotificationJob,
  addSendEmailJob,
} from '../../../queue/index.js';
import {
  createAdminUser,
  createWorkspaceWithOwner,
} from '../../factories/index.js';

describe('serviceUpdateWorkspaceLimits audit logging', () => {
  it('logs an activity row when AI caps are raised, attributed to the admin', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:             WorkspacePlan.ENTERPRISE,
      maxMembers:       100,
      maxStorage:       10_000,
      aiDailyCalls:     9000,
      aiMonthlyTokens:  100_000_000,
      aiMaxOutputTokens: 8192,
    });

    const activity = await prisma.activity.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
    });

    expect(activity).not.toBeNull();
    // Who — the acting Focura admin
    expect(activity!.userId).toBe(admin.id);
    // What — a workspace limits update
    expect(activity!.action).toBe('UPDATED');
    expect(activity!.entityType).toBe('WORKSPACE');
    expect(activity!.entityId).toBe(workspace.id);
    expect(activity!.workspaceSlug).toBe(workspace.slug);

    const metadata = activity!.metadata as Record<string, any>;
    expect(metadata.source).toBe('focura-admin');
    // Which caps — the before/after diff
    expect(metadata.changes.aiDailyCalls).toEqual({ from: null, to: 9000 });
    expect(metadata.changes.aiMonthlyTokens).toEqual({ from: null, to: 100_000_000 });
    expect(metadata.changes.aiMaxOutputTokens).toEqual({ from: null, to: 8192 });
  });

  it('logs plan/member/storage changes alongside AI overrides', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:       WorkspacePlan.BUSINESS,
      maxMembers: 50,
      maxStorage: 20_000,
    });

    const activity = await prisma.activity.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
    });

    const metadata = activity!.metadata as Record<string, any>;
    // Factory workspace: plan PRO, maxMembers 5, maxStorage 1024 (schema defaults)
    expect(metadata.changes.plan).toEqual({ from: WorkspacePlan.PRO, to: WorkspacePlan.BUSINESS });
    expect(metadata.changes.maxMembers).toEqual({ from: 5, to: 50 });
    expect(metadata.changes.maxStorage).toEqual({ from: 1024, to: 20_000 });
  });

  it('does not log when the admin re-saves identical values (no-op)', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:       WorkspacePlan.PRO,
      maxMembers: 100,
      maxStorage: 10_000,
    });
    // Identical submission — nothing changed → no new audit row
    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:       WorkspacePlan.PRO,
      maxMembers: 100,
      maxStorage: 10_000,
    });

    const count = await prisma.activity.count({ where: { workspaceId: workspace.id } });
    expect(count).toBe(1);
  });

  it('notifies and emails the owner when limits change', async () => {
    const admin = await createAdminUser();
    const { user, workspace } = await createWorkspaceWithOwner();

    vi.mocked(addSendNotificationJob).mockClear();
    vi.mocked(addSendEmailJob).mockClear();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:             WorkspacePlan.ENTERPRISE,
      maxMembers:       100,
      maxStorage:       10_000,
      aiDailyCalls:     9000,
      aiMonthlyTokens:  100_000_000,
      aiMaxOutputTokens: 8192,
    });

    // In-app notification — addressed to the workspace owner, message capped
    // to the first 3 changes (6 fields changed here) with a "+N more" suffix.
    expect(addSendNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId:   user.id,
        senderId: admin.id,
        type:     'PROJECT_UPDATE',
        title:    expect.stringContaining('Limits Updated'),
        message:  expect.stringContaining('Plan PRO → ENTERPRISE'),
      }),
    );
    expect(addSendNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('+3 more'),
      }),
    );

    // Email — same recipient, dedicated template with the change summary
    expect(addSendEmailJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspace-limits-changed-email',
        to:   user.email,
        data: expect.objectContaining({
          toEmail:       user.email,
          workspaceName: workspace.name,
          changes:       expect.arrayContaining([
            expect.objectContaining({ field: 'aiDailyCalls', label: 'AI calls per day', to: '9,000' }),
          ]),
        }),
      }),
    );
  });

  it('does not notify or email on a no-op re-save', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:       WorkspacePlan.PRO,
      maxMembers: 100,
      maxStorage: 10_000,
    });

    vi.mocked(addSendNotificationJob).mockClear();
    vi.mocked(addSendEmailJob).mockClear();

    await serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
      plan:       WorkspacePlan.PRO,
      maxMembers: 100,
      maxStorage: 10_000,
    });

    expect(addSendNotificationJob).not.toHaveBeenCalled();
    expect(addSendEmailJob).not.toHaveBeenCalled();
  });

  it('still updates limits when audit logging fails (never fails the request)', async () => {
    const admin = await createAdminUser();
    const { workspace } = await createWorkspaceWithOwner();

    const spy = vi
      .spyOn(ActivityMutation, 'createActivity')
      .mockRejectedValueOnce(new Error('audit db down'));

    await expect(
      serviceUpdateWorkspaceLimits(workspace.slug, admin.id, {
        plan:             WorkspacePlan.ENTERPRISE,
        maxMembers:       100,
        maxStorage:       10_000,
        aiDailyCalls:     9000,
        aiMonthlyTokens:  100_000_000,
        aiMaxOutputTokens: 8192,
      }),
    ).resolves.toBeDefined();

    // The limits update itself still landed
    const fresh = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(fresh?.plan).toBe(WorkspacePlan.ENTERPRISE);
    expect(fresh?.aiDailyCalls).toBe(9000);

    spy.mockRestore();
  });
});

describe('buildLimitChangeSummary', () => {
  it('formats plan, AI caps, and storage changes with friendly labels', () => {
    const parts = buildLimitChangeSummary({
      plan:              { from: 'PRO', to: 'ENTERPRISE' },
      aiDailyCalls:      { from: null, to: 9000 },
      aiMonthlyTokens:   { from: 500000, to: 100000000 },
      aiMaxOutputTokens: { from: null, to: 8192 },
      maxStorage:        { from: 1024, to: 20000 },
      maxMembers:        { from: 5, to: 100 },
    });

    expect(parts).toEqual([
      { field: 'plan',              label: 'Plan',                   from: 'PRO',     to: 'ENTERPRISE' },
      { field: 'aiDailyCalls',      label: 'AI calls per day',       from: 'default', to: '9,000' },
      { field: 'aiMonthlyTokens',   label: 'AI tokens per month',    from: '500,000', to: '100M' },
      { field: 'aiMaxOutputTokens', label: 'AI max output per response', from: 'default', to: '8,192' },
      { field: 'maxStorage',        label: 'Max storage',            from: '1,024 MB', to: '20,000 MB' },
      { field: 'maxMembers',        label: 'Max members',            from: '5',      to: '100' },
    ]);
  });

  it('falls back to the raw field name for unknown fields', () => {
    expect(buildLimitChangeSummary({ customLimit: { from: 1, to: 2 } })).toEqual([
      { field: 'customLimit', label: 'customLimit', from: '1', to: '2' },
    ]);
  });
});

describe('formatLimitChangeValue', () => {
  it('compacts monthly token values and keeps plan strings', () => {
    expect(formatLimitChangeValue('aiMonthlyTokens', 1500000)).toBe('1.5M');
    expect(formatLimitChangeValue('plan', 'ENTERPRISE')).toBe('ENTERPRISE');
    expect(formatLimitChangeValue('aiDailyCalls', null)).toBe('default');
  });
});
