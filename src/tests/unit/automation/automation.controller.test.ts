/**
 * src/tests/unit/automation/automation.controller.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listAutomations,
  getAutomation,
  getAutomationRuns,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from '../../../modules/automation/automation.controller.js';
import { AutomationQuery } from '../../../modules/automation/automation.query.js';
import { AutomationMutation } from '../../../modules/automation/automation.mutation.js';
import { ValidationError } from '../../../errors/index.js';

const mockList = vi.fn();
const mockGetById = vi.fn();
const mockGetRunHistory = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../../modules/automation/automation.query.js', () => ({
  AutomationQuery: {
    list: (...args: unknown[]) => mockList(...args),
    getById: (...args: unknown[]) => mockGetById(...args),
    getRunHistory: (...args: unknown[]) => mockGetRunHistory(...args),
  },
}));

vi.mock('../../../modules/automation/automation.mutation.js', () => ({
  AutomationMutation: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
  },
}));

function mockReq(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'user1' }, params: {}, query: {}, body: {}, ...overrides };
}

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as any;
}

const mockNext = vi.fn();

describe('automation controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listAutomations parses query and returns rules', async () => {
    mockList.mockResolvedValue([{ id: 'r1' }]);
    const req = mockReq({ query: { workspaceId: 'ws1' } });
    const res = mockRes();

    await listAutomations(req as any, res, mockNext);

    expect(mockList).toHaveBeenCalledWith('user1', 'ws1', undefined);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'r1' }] });
  });

  it('listAutomations forwards projectId when provided', async () => {
    mockList.mockResolvedValue([]);
    const req = mockReq({ query: { workspaceId: 'ws1', projectId: 'p1' } });
    const res = mockRes();

    await listAutomations(req as any, res, mockNext);

    expect(mockList).toHaveBeenCalledWith('user1', 'ws1', 'p1');
  });

  it('listAutomations throws ValidationError without workspaceId', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();

    await listAutomations(req as any, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockList).not.toHaveBeenCalled();
  });

  it('getAutomationRuns returns run history', async () => {
    mockGetRunHistory.mockResolvedValue([{ id: 'run1' }]);
    const req = mockReq({ params: { id: 'r1' } });
    const res = mockRes();

    await getAutomationRuns(req as any, res, mockNext);

    expect(mockGetRunHistory).toHaveBeenCalledWith('user1', 'r1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'run1' }] });
  });

  it('getAutomation returns a single rule', async () => {
    mockGetById.mockResolvedValue({ id: 'r1' });
    const req = mockReq({ params: { id: 'r1' } });
    const res = mockRes();

    await getAutomation(req as any, res, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'r1' } });
  });

  it('createAutomation returns 201 on valid input', async () => {
    const rule = { id: 'r1', name: 'Rule' };
    mockCreate.mockResolvedValue(rule);
    const req = mockReq({
      body: {
        workspaceId: 'ws1',
        name: 'Rule',
        triggerType: 'STATUS_CHANGED',
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      },
    });
    const res = mockRes();

    await createAutomation(req as any, res, mockNext);

    expect(mockCreate).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({ workspaceId: 'ws1', name: 'Rule' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Automation rule created',
      data: rule,
    });
  });

  it('createAutomation rejects invalid actions', async () => {
    const req = mockReq({
      body: {
        workspaceId: 'ws1',
        name: 'Rule',
        triggerType: 'STATUS_CHANGED',
        actions: [],
      },
    });
    const res = mockRes();

    await createAutomation(req as any, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('updateAutomation passes validated data', async () => {
    const updated = { id: 'r1', enabled: false };
    mockUpdate.mockResolvedValue(updated);
    const req = mockReq({ params: { id: 'r1' }, body: { enabled: false } });
    const res = mockRes();

    await updateAutomation(req as any, res, mockNext);

    expect(mockUpdate).toHaveBeenCalledWith('user1', 'r1', { enabled: false });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Automation rule updated',
      data: updated,
    });
  });

  it('updateAutomation rejects an empty body', async () => {
    const req = mockReq({ params: { id: 'r1' }, body: {} });
    const res = mockRes();

    await updateAutomation(req as any, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deleteAutomation returns success', async () => {
    mockRemove.mockResolvedValue({ success: true });
    const req = mockReq({ params: { id: 'r1' } });
    const res = mockRes();

    await deleteAutomation(req as any, res, mockNext);

    expect(mockRemove).toHaveBeenCalledWith('user1', 'r1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Automation rule deleted',
      data: { success: true },
    });
  });
});
