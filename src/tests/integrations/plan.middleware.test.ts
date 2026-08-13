import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requireProjectSlot,
  requireMemberSlot,
  requireMemberSlotForInvitation,
  requireFileSizeLimit,
  requireMeetingSlot,
  requireAnalyticsAccess,
  requireApiAccess,
  requireApiAccessForUser,
  requireWorkspaceCreationSlot,
} from '../../../src/modules/billing/plan.middleware.js';

import { prisma } from '../../../src/lib/prisma.js';
import { BillingService } from '../../../src/modules/billing/billing.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}) {
  return {
    params: {},
    headers: {},
    user: { id: 'user-1' },
    ...overrides,
  } as any;
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

function mockNext(): NextFunction {
  return vi.fn();
}

function getError(next: NextFunction) {
  return (next as any).mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// requireProjectSlot
// ─────────────────────────────────────────────────────────────────────────────
describe('requireProjectSlot', () => {
  it('allows when under limit', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxProjects: 5,
    } as any);

    vi.spyOn(prisma.project, 'count').mockResolvedValue(2 as any);

    const req = mockReq({ body: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireProjectSlot(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('blocks when limit reached', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxProjects: 2,
    } as any);

    vi.spyOn(prisma.project, 'count').mockResolvedValue(2 as any);

    const req = mockReq({
      body: { workspaceId: 'ws-1' },
      params: { workspaceId: 'ws-1' },
    });
    const res = mockRes();
    const next = mockNext();

    await requireProjectSlot(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('allows unlimited plan', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxProjects: -1,
    } as any);

    const req = mockReq({ body: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireProjectSlot(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireMemberSlot
// ─────────────────────────────────────────────────────────────────────────────
describe('requireMemberSlot', () => {
  it('blocks when member limit reached', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxMembersPerWs: 1,
    } as any);

    vi.spyOn(prisma.workspaceMember, 'count').mockResolvedValue(1 as any);

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireMemberSlot(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('allows when under member limit', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxMembersPerWs: 5,
    } as any);

    vi.spyOn(prisma.workspaceMember, 'count').mockResolvedValue(3 as any);

    const req = mockReq({ params: { id: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireMemberSlot(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireMemberSlotForInvitation
// ─────────────────────────────────────────────────────────────────────────────
describe('requireMemberSlotForInvitation', () => {
  it('blocks when the invited workspace is at its member cap', async () => {
    vi.spyOn(prisma.workspaceInvitation, 'findUnique').mockResolvedValue({
      workspaceId: 'ws-1',
      status: 'PENDING',
    } as any);
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxMembersPerWs: 2,
    } as any);
    vi.spyOn(prisma.workspaceMember, 'count').mockResolvedValue(2 as any);

    const req = mockReq({ params: { token: 'tok-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireMemberSlotForInvitation(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('allows when the invited workspace is under its member cap', async () => {
    vi.spyOn(prisma.workspaceInvitation, 'findUnique').mockResolvedValue({
      workspaceId: 'ws-1',
      status: 'PENDING',
    } as any);
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxMembersPerWs: 5,
    } as any);
    vi.spyOn(prisma.workspaceMember, 'count').mockResolvedValue(3 as any);

    const req = mockReq({ params: { token: 'tok-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireMemberSlotForInvitation(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('passes through unknown or non-PENDING invitations (controller reports the canonical error)', async () => {
    vi.spyOn(prisma.workspaceInvitation, 'findUnique').mockResolvedValue({
      workspaceId: 'ws-1',
      status: 'ACCEPTED',
    } as any);
    vi.spyOn(BillingService, 'getWorkspacePlanLimits');

    const req = mockReq({ params: { token: 'tok-used' } });
    const res = mockRes();
    const next = mockNext();

    await requireMemberSlotForInvitation(req, res, next);

    expect(next).toHaveBeenCalledWith();
    // No plan-limit lookup happens for non-PENDING invites.
    expect(BillingService.getWorkspacePlanLimits).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireFileSizeLimit
// ─────────────────────────────────────────────────────────────────────────────
describe('requireFileSizeLimit', () => {
  it('allows uploads when workspaceId is missing (profile uploads / controller-enforced)', async () => {
    const req = mockReq({
      headers: { 'content-length': '99999999' },
    });
    const res = mockRes();
    const next = mockNext();

    await requireFileSizeLimit(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('resolves workspaceId from the request body (multipart uploads)', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxFileSizeMb: 1,
    } as any);

    const req = mockReq({
      body: { workspaceId: 'ws-body' },
      headers: { 'content-length': `${5 * 1024 * 1024}` },
    });
    const res = mockRes();
    const next = mockNext();

    await requireFileSizeLimit(req, res, next);

    expect(BillingService.getWorkspacePlanLimits).toHaveBeenCalledWith('ws-body');
    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('blocks large file upload', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxFileSizeMb: 1,
    } as any);

    const req = mockReq({
      params: { workspaceId: 'ws-1' },
      headers: { 'content-length': `${5 * 1024 * 1024}` },
    });

    const res = mockRes();
    const next = mockNext();

    await requireFileSizeLimit(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireMeetingSlot
// ─────────────────────────────────────────────────────────────────────────────
describe('requireMeetingSlot', () => {
  it('blocks when monthly limit exceeded', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      maxMeetingsPerMo: 1,
    } as any);

    vi.spyOn(prisma.meeting, 'count').mockResolvedValue(1 as any);

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireMeetingSlot(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireAnalyticsAccess
// ─────────────────────────────────────────────────────────────────────────────
describe('requireAnalyticsAccess', () => {
  it('blocks when analytics disabled (member)', async () => {
    vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
      role: 'OWNER',
    } as any);
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      analyticsAccess: false,
    } as any);

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireAnalyticsAccess(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('blocks non-members before checking the plan tier', async () => {
    vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue(null as any);
    const planSpy = vi.spyOn(BillingService, 'getWorkspacePlanLimits');

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireAnalyticsAccess(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
    // The plan tier must not be queried for non-members (no tier probing)
    expect(planSpy).not.toHaveBeenCalled();
  });

  it('allows admins/owners on plans with analytics enabled', async () => {
    vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
      role: 'ADMIN',
    } as any);
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      analyticsAccess: true,
    } as any);

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireAnalyticsAccess(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireApiAccess
// ─────────────────────────────────────────────────────────────────────────────
describe('requireApiAccessForUser', () => {
  it('blocks API-key creation when the user has no Business workspace', async () => {
    vi.spyOn(BillingService, 'getUserHighestPlan').mockResolvedValue('PRO' as any);

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await requireApiAccessForUser(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('allows API-key creation for Business users', async () => {
    vi.spyOn(BillingService, 'getUserHighestPlan').mockResolvedValue('BUSINESS' as any);

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await requireApiAccessForUser(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireApiAccess', () => {
  it('blocks when API access disabled', async () => {
    vi.spyOn(BillingService, 'getWorkspacePlanLimits').mockResolvedValue({
      apiAccess: false,
    } as any);

    const req = mockReq({ params: { workspaceId: 'ws-1' } });
    const res = mockRes();
    const next = mockNext();

    await requireApiAccess(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireWorkspaceCreationSlot
// ─────────────────────────────────────────────────────────────────────────────
describe('requireWorkspaceCreationSlot', () => {
  it('blocks when user exceeds workspace limit', async () => {
    vi.spyOn(BillingService, 'getUserWorkspaceCreationLimit').mockResolvedValue(1);

    vi.spyOn(prisma.workspace, 'count').mockResolvedValue(1 as any);

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await requireWorkspaceCreationSlot(req, res, next);

    expect(next).toHaveBeenCalled();

    const error = getError(next);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});