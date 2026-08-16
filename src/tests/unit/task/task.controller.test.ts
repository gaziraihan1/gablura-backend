import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetTasks,
  mockGetTaskStats,
  mockGetTaskOverview,
  mockGetTaskById,
  mockCreateTask,
  mockUpdateTask,
  mockUpdateTaskStatus,
  mockDeleteTask,
  mockLogCreated,
  mockLogStatusChanged,
  mockLogUpdated,
  mockLogDeleted,
  mockNotifyNewAssignees,
  mockNotifyAddedAssignees,
  mockNotifyTaskCompleted,
  mockRecalculateDay,
  mockGetPersonalQuotaInfo,
  mockGetWorkspaceQuotaInfo,
  mockEmitAutomationEvent,
} = vi.hoisted(() => ({
  mockGetTasks: vi.fn(),
  mockGetTaskStats: vi.fn(),
  mockGetTaskOverview: vi.fn(),
  mockGetTaskById: vi.fn(),
  mockCreateTask: vi.fn(),
  mockUpdateTask: vi.fn(),
  mockUpdateTaskStatus: vi.fn(),
  mockDeleteTask: vi.fn(),
  mockLogCreated: vi.fn(),
  mockLogStatusChanged: vi.fn(),
  mockLogUpdated: vi.fn(),
  mockLogDeleted: vi.fn(),
  mockNotifyNewAssignees: vi.fn(),
  mockNotifyAddedAssignees: vi.fn(),
  mockNotifyTaskCompleted: vi.fn(),
  mockRecalculateDay: vi.fn(),
  mockGetPersonalQuotaInfo: vi.fn(),
  mockGetWorkspaceQuotaInfo: vi.fn(),
  mockEmitAutomationEvent: vi.fn(),
}));

const {
  mockFindUnique,
  mockTaskUpdate,
  mockExecuteRaw,
  mockWorkspaceMemberFindFirst,
  mockProjectFindUnique,
  mockIntegrationFindFirst,
  mockPrisma,
} = vi.hoisted(() => {
  const mockFindUnique = vi.fn();
  const mockTaskUpdate = vi.fn();
  const mockExecuteRaw = vi.fn();
  const mockWorkspaceMemberFindFirst = vi.fn();
  const mockProjectFindUnique = vi.fn();
  const mockIntegrationFindFirst = vi.fn();
  const mockPrisma = {
    task: {
      findUnique: mockFindUnique,
      update: mockTaskUpdate,
    },
    workspaceMember: {
      findFirst: mockWorkspaceMemberFindFirst,
    },
    project: {
      findUnique: mockProjectFindUnique,
    },
    integration: {
      findFirst: mockIntegrationFindFirst,
    },
    $executeRaw: mockExecuteRaw,
  };
  return {
    mockFindUnique,
    mockTaskUpdate,
    mockExecuteRaw,
    mockWorkspaceMemberFindFirst,
    mockProjectFindUnique,
    mockIntegrationFindFirst,
    mockPrisma,
  };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

vi.mock('../../../modules/task/task.query.js', () => ({
  TaskQuery: {
    getTasks: mockGetTasks,
    getTaskStats: mockGetTaskStats,
    getTaskOverview: mockGetTaskOverview,
    getTaskById: mockGetTaskById,
  },
}));

vi.mock('../../../modules/task/task.mutation.js', () => ({
  TaskMutation: {
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    updateTaskStatus: mockUpdateTaskStatus,
    deleteTask: mockDeleteTask,
  },
}));
vi.mock('../../../modules/automation/automation.events.js', () => ({
  emitAutomationEvent: mockEmitAutomationEvent,
}));

vi.mock('../../../modules/task/task.activity.js', () => ({
  TaskActivity: {
    logCreated: mockLogCreated,
    logStatusChanged: mockLogStatusChanged,
    logUpdated: mockLogUpdated,
    logDeleted: mockLogDeleted,
  },
}));

vi.mock('../../../modules/task/task.notifications.js', () => ({
  TaskNotifications: {
    notifyNewAssignees: mockNotifyNewAssignees,
    notifyAddedAssignees: mockNotifyAddedAssignees,
    notifyTaskCompleted: mockNotifyTaskCompleted,
  },
}));

vi.mock('../../../modules/calendar/calendar.aggregation.js', () => ({
  CalendarAggregation: {
    recalculateDay: mockRecalculateDay,
  },
}));

vi.mock('../../../modules/task/task.limits.js', () => ({
  getPersonalQuotaInfo: mockGetPersonalQuotaInfo,
  getWorkspaceQuotaInfo: mockGetWorkspaceQuotaInfo,
}));

vi.mock('../../../errors/index.js', async () => {
  const actual = await vi.importActual('../../../errors/index.js');
  return actual;
});

import {
  getTasks,
  getTaskStats,
  getTaskOverview,
  createTask,
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  getPersonalQuota,
  getWorkspaceQuota,
  linkGitHubEntity,
  linkSlackMessage,
  unlinkSlackMessage,
  unlinkGitHubEntity,
} from '../../../modules/task/task.controller.js';

import { ValidationError } from '../../../errors/index.js';

const mockReq = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'user1', email: 'test@test.com', role: 'ADMIN' },
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
  body: {} as Record<string, unknown>,
  headers: {} as Record<string, string>,
  ...overrides,
});

const mockRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res;
};

const mockNext = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTasks
// ═══════════════════════════════════════════════════════════════════════════════

describe('getTasks', () => {
  it('should return tasks on valid query', async () => {
    const result = {
      data: [{ id: 't1', title: 'Task 1' }],
      pagination: { page: 1, pageSize: 10, total: 1 },
    };
    mockGetTasks.mockResolvedValue(result);

    const req = mockReq({ query: { page: '1', pageSize: '10' } });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });

  it('should parse comma-separated labelIds', async () => {
    mockGetTasks.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0 } });

    const req = mockReq({ query: { labelIds: 'lbl1,lbl2,lbl3' } });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.objectContaining({ labelIds: ['lbl1', 'lbl2', 'lbl3'] }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should set labelIds to undefined when not provided', async () => {
    mockGetTasks.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0 } });

    const req = mockReq({ query: {} });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.objectContaining({ labelIds: undefined }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should filter empty strings from labelIds', async () => {
    mockGetTasks.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0 } });

    const req = mockReq({ query: { labelIds: 'lbl1,,lbl2,' } });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.objectContaining({ labelIds: ['lbl1', 'lbl2'] }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should throw ValidationError on invalid query', async () => {
    const req = mockReq({ query: { pageSize: '999' } });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.any(ValidationError),
    );
  });

  it('should pass sortBy and sortOrder to TaskQuery', async () => {
    mockGetTasks.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0 } });

    const req = mockReq({ query: { sortBy: 'dueDate', sortOrder: 'desc' } });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockGetTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { sortBy: 'dueDate', sortOrder: 'desc' },
    );
  });

  it('should forward errors to next', async () => {
    const error = new Error('db failure');
    mockGetTasks.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await getTasks(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTaskStats
// ═══════════════════════════════════════════════════════════════════════════════

describe('getTaskStats', () => {
  it('should return stats on valid query', async () => {
    const stats = { total: 5, completed: 2, inProgress: 3 };
    mockGetTaskStats.mockResolvedValue(stats);

    const req = mockReq({ query: { workspaceId: 'ws1' } });
    const res = mockRes();

    await getTaskStats(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: stats });
  });

  it('should forward errors to next', async () => {
    const error = new Error('stats error');
    mockGetTaskStats.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await getTaskStats(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should pass userId from req.user', async () => {
    mockGetTaskStats.mockResolvedValue({});

    const req = mockReq({
      user: { id: 'user-abc', email: 'a@b.com', role: 'USER' },
      query: {},
    });
    const res = mockRes();

    await getTaskStats(req as any, res as any, mockNext);

    expect(mockGetTaskStats).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-abc' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTaskOverview
// ═══════════════════════════════════════════════════════════════════════════════

describe('getTaskOverview', () => {
  it('should return overview for valid task id', async () => {
    const overview = { id: 't1', title: 'Task', status: 'TODO' };
    mockGetTaskOverview.mockResolvedValue(overview);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await getTaskOverview(req as any, res as any, mockNext);

    expect(mockGetTaskOverview).toHaveBeenCalledWith('t1', 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: overview });
  });

  it('should forward errors to next', async () => {
    const error = new Error('not found');
    mockGetTaskOverview.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await getTaskOverview(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createTask
// ═══════════════════════════════════════════════════════════════════════════════

describe('createTask', () => {
  it('should create task and return 201', async () => {
    const task = { id: 't1', title: 'New Task', workspaceId: 'ws1', dueDate: new Date('2026-01-01') };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: ['a1', 'a2'] });
      return task;
    });

    const req = mockReq({ body: { title: 'New Task', focusRequired: true, energyType: 'HIGH', intent: 'EXECUTION' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Task created successfully',
      data: task,
    });
  });

  it('should log activity when task has workspaceId', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockLogCreated).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Task',
      userId: 'user1',
      workspaceId: 'ws1',
      focusRequired: undefined,
      energyType: undefined,
      intent: undefined,
    });
  });

  it('should not log activity when task has no workspaceId', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: null, dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockLogCreated).not.toHaveBeenCalled();
  });

  it('should notify assignees when assigneeIds is non-empty', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: ['a1'] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockNotifyNewAssignees).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Task',
      assigneeIds: ['a1'],
      creatorId: 'user1',
    });
  });

  it('should not notify when assigneeIds is empty', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockNotifyNewAssignees).not.toHaveBeenCalled();
  });

  it('should recalculate calendar when task has dueDate', async () => {
    const dueDate = new Date('2026-06-15');
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', dueDate };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task', dueDate: '2026-06-15' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', 'ws1', dueDate);
  });

  it('should not recalculate calendar when task has no dueDate', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).not.toHaveBeenCalled();
  });

  it('should pass undefined workspaceId to recalculateDay when workspaceId is null', async () => {
    const dueDate = new Date('2026-06-15');
    const task = { id: 't1', title: 'Task', workspaceId: null, dueDate };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task', dueDate: '2026-06-15' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', undefined, dueDate);
  });

  it('should throw ValidationError on invalid body', async () => {
    const req = mockReq({ body: { description: 'no title' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should throw ValidationError when title is empty string', async () => {
    const req = mockReq({ body: { title: '' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should forward errors to next', async () => {
    const error = new Error('create failed');
    mockCreateTask.mockRejectedValue(error);

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getTask
// ═══════════════════════════════════════════════════════════════════════════════

describe('getTask', () => {
  it('should return task by id', async () => {
    const task = { id: 't1', title: 'Task 1' };
    mockGetTaskById.mockResolvedValue(task);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await getTask(req as any, res as any, mockNext);

    expect(mockGetTaskById).toHaveBeenCalledWith('t1', 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: task });
  });

  it('should forward errors to next', async () => {
    const error = new Error('not found');
    mockGetTaskById.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await getTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateTask
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateTask', () => {
  it('should update task and return success', async () => {
    const task = { id: 't1', title: 'Updated', workspaceId: 'ws1' };
    mockFindUnique.mockResolvedValue({ dueDate: new Date('2026-01-01') });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { ...task, dueDate: new Date('2026-01-05') } });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Updated' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Task updated successfully',
      data: task,
    });
  });

  it('should recalculate calendar for old and new due dates', async () => {
    const oldDueDate = new Date('2026-01-01');
    const newDueDate = new Date('2026-01-05');
    mockFindUnique.mockResolvedValue({ dueDate: oldDueDate });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: newDueDate } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { dueDate: '2026-01-05' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledTimes(2);
    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', 'ws1', oldDueDate);
    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', 'ws1', newDueDate);
  });

  it('should not duplicate recalculation when old and new dueDate are the same', async () => {
    const sameDate = new Date('2026-01-01');
    mockFindUnique.mockResolvedValue({ dueDate: sameDate });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: sameDate } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { dueDate: '2026-01-01' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledTimes(1);
  });

  it('should recalculate only new date when oldTask has no dueDate', async () => {
    mockFindUnique.mockResolvedValue({ dueDate: null });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: new Date('2026-01-05') } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { dueDate: '2026-01-05' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledTimes(1);
  });

  it('should recalculate only old date when new dueDate is null', async () => {
    const oldDueDate = new Date('2026-01-01');
    mockFindUnique.mockResolvedValue({ dueDate: oldDueDate });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: null } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { dueDate: null } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledTimes(1);
    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', 'ws1', oldDueDate);
  });

  it('should not recalculate when both dates are null', async () => {
    mockFindUnique.mockResolvedValue({ dueDate: null });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: null } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Updated' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).not.toHaveBeenCalled();
  });

  it('should handle oldTask being null (task not found in prisma)', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', workspaceId: 'ws1', dueDate: new Date('2026-01-05') } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Updated' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidationError on invalid body', async () => {
    const req = mockReq({ params: { id: 't1' }, body: { status: 'INVALID_STATUS' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should forward errors to next', async () => {
    const error = new Error('update failed');
    mockFindUnique.mockResolvedValue({ dueDate: null });
    mockUpdateTask.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Updated' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should log an UPDATED activity with changed fields and the acting user', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Old Title', description: 'Old desc', priority: 'MEDIUM', status: 'TODO', projectId: 'p1',
      dueDate: null, startDate: null, estimatedHours: 4,
      focusRequired: false, focusLevel: null, energyType: null, distractionCost: null, intent: 'EXECUTION',
      assignees: [{ userId: 'u1' }], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', title: 'New Title', workspaceId: 'ws1' } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'New Title', priority: 'HIGH' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockLogUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId:      't1',
        taskTitle:   'New Title',
        userId:      'user1',
        workspaceId: 'ws1',
        changes:     expect.objectContaining({ title: 'New Title', priority: 'HIGH' }),
      }),
    );
  });

  it('should not log an UPDATED activity when nothing actually changed', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Same', description: null, priority: 'MEDIUM', status: 'TODO', projectId: null,
      dueDate: null, startDate: null, estimatedHours: null,
      focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
      assignees: [], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', title: 'Same', workspaceId: 'ws1' } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Same', priority: 'MEDIUM' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockLogUpdated).not.toHaveBeenCalled();
  });

  it('should not log an UPDATED activity for personal tasks (no workspaceId)', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Old', description: null, priority: 'MEDIUM', status: 'TODO', projectId: null,
      dueDate: null, startDate: null, estimatedHours: null,
      focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
      assignees: [], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task: { id: 't1', title: 'New', workspaceId: null } });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'New' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockLogUpdated).not.toHaveBeenCalled();
  });

  it('should emit a STATUS_CHANGED automation event when the edit form changes status', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Old', description: null, priority: 'MEDIUM', status: 'TODO', projectId: 'p1',
      dueDate: null, startDate: null, estimatedHours: null,
      focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
      assignees: [], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1' },
        oldStatus: 'TODO',
        newStatus: 'COMPLETED',
      });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'COMPLETED' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'STATUS_CHANGED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
      fromStatus: 'TODO',
      toStatus: 'COMPLETED',
    });
  });

  it('should not emit a STATUS_CHANGED event when the status did not change', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Old', description: null, priority: 'MEDIUM', status: 'TODO', projectId: 'p1',
      dueDate: null, startDate: null, estimatedHours: null,
      focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
      assignees: [], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1' },
        oldStatus: 'TODO',
        newStatus: 'TODO',
      });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Renamed' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalled();
  });

  it('should not emit a STATUS_CHANGED event for personal tasks', async () => {
    mockFindUnique.mockResolvedValue({
      title: 'Old', description: null, priority: 'MEDIUM', status: 'TODO', projectId: null,
      dueDate: null, startDate: null, estimatedHours: null,
      focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
      assignees: [], labels: [],
    });
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: { id: 't1', title: 'Task', workspaceId: null },
        oldStatus: 'TODO',
        newStatus: 'COMPLETED',
      });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'COMPLETED' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateTaskStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateTaskStatus', () => {
  it('should update status and return success', async () => {
    const task = { id: 't1', title: 'Task', status: 'IN_PROGRESS' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: task });
  });

  it('should log status change when workspace exists and status differs', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockLogStatusChanged).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Task',
      userId: 'user1',
      workspaceId: 'ws1',
      oldStatus: 'TODO',
      newStatus: 'IN_PROGRESS',
    });
  });

  it('should not log status change when workspaceId is missing', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: null };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockLogStatusChanged).not.toHaveBeenCalled();
  });

  it('should not log status change when oldStatus === newStatus', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'TODO' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'TODO' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockLogStatusChanged).not.toHaveBeenCalled();
  });

  it('should not log when oldStatus is null', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: null, newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockLogStatusChanged).not.toHaveBeenCalled();
  });

  it('should not log when newStatus is null', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: null });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'TODO' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockLogStatusChanged).not.toHaveBeenCalled();
  });

  it('should notify task completed when newStatus is COMPLETED and old is not', async () => {
    const task = { id: 't1', title: 'Task' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'IN_PROGRESS', newStatus: 'COMPLETED' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'COMPLETED' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNotifyTaskCompleted).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Task',
      userId: 'user1',
    });
  });

  it('should not notify when newStatus is COMPLETED and old was already COMPLETED', async () => {
    const task = { id: 't1', title: 'Task' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'COMPLETED', newStatus: 'COMPLETED' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'COMPLETED' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNotifyTaskCompleted).not.toHaveBeenCalled();
  });

  it('should not notify when newStatus is not COMPLETED', async () => {
    const task = { id: 't1', title: 'Task' };
    mockUpdateTaskStatus.mockImplementation(async (_id: string, _userId: string, _status: string, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ params: { id: 't1' }, body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNotifyTaskCompleted).not.toHaveBeenCalled();
  });

  it('should throw ValidationError on invalid status', async () => {
    const req = mockReq({ params: { id: 't1' }, body: { status: 'DOES_NOT_EXIST' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should throw ValidationError when status is missing', async () => {
    const req = mockReq({ params: { id: 't1' }, body: {} });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should forward errors to next', async () => {
    const error = new Error('status update failed');
    mockUpdateTaskStatus.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' }, body: { status: 'COMPLETED' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteTask
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteTask', () => {
  it('should delete task and return success', async () => {
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate: null,
          workspaceId: null,
          project: null,
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Task deleted successfully',
    });
  });

  it('should log deletion when task has a project with workspaceId', async () => {
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate: null,
          workspaceId: 'ws1',
          project: { workspaceId: 'ws1' },
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockLogDeleted).toHaveBeenCalledWith({
      taskId: 't1',
      taskTitle: 'Task',
      userId: 'user1',
      workspaceId: 'ws1',
      status: 'TODO',
      priority: 'HIGH',
    });
  });

  it('should not log deletion when project is null', async () => {
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate: null,
          workspaceId: null,
          project: null,
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockLogDeleted).not.toHaveBeenCalled();
  });

  it('should not log deletion when project has no workspaceId', async () => {
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate: null,
          workspaceId: null,
          project: { workspaceId: null },
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockLogDeleted).not.toHaveBeenCalled();
  });

  it('should recalculate calendar when deleted task has dueDate', async () => {
    const dueDate = new Date('2026-03-10');
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate,
          workspaceId: 'ws1',
          project: null,
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', 'ws1', dueDate);
  });

  it('should not recalculate calendar when deleted task has no dueDate', async () => {
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate: null,
          workspaceId: 'ws1',
          project: null,
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).not.toHaveBeenCalled();
  });

  it('should pass undefined workspaceId to recalculateDay when workspaceId is null', async () => {
    const dueDate = new Date('2026-03-10');
    mockDeleteTask.mockImplementation(async (_id: string, _userId: string, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: {
          id: 't1',
          title: 'Task',
          status: 'TODO',
          priority: 'HIGH',
          dueDate,
          workspaceId: null,
          project: null,
        },
      });
    });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockRecalculateDay).toHaveBeenCalledWith('user1', undefined, dueDate);
  });

  it('should forward errors to next', async () => {
    const error = new Error('delete failed');
    mockDeleteTask.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await deleteTask(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPersonalQuota
// ═══════════════════════════════════════════════════════════════════════════════

describe('getPersonalQuota', () => {
  it('should return personal quota info', async () => {
    const info = { plan: 'FREE', dailyLimit: 10, usedToday: 3, remaining: 7, resetAt: new Date(), perMinuteLimit: null };
    mockGetPersonalQuotaInfo.mockResolvedValue(info);

    const req = mockReq();
    const res = mockRes();

    await getPersonalQuota(req as any, res as any, mockNext);

    expect(mockGetPersonalQuotaInfo).toHaveBeenCalledWith('user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: info });
  });

  it('should forward errors to next', async () => {
    const error = new Error('quota error');
    mockGetPersonalQuotaInfo.mockRejectedValue(error);

    const req = mockReq();
    const res = mockRes();

    await getPersonalQuota(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getWorkspaceQuota
// ═══════════════════════════════════════════════════════════════════════════════

describe('getWorkspaceQuota', () => {
  it('should return workspace quota info', async () => {
    const info = { plan: 'PRO', dailyWorkspaceLimit: 100, members: [] };
    mockGetWorkspaceQuotaInfo.mockResolvedValue(info);

    const req = mockReq({ params: { workspaceId: 'ws1' } });
    const res = mockRes();

    await getWorkspaceQuota(req as any, res as any, mockNext);

    expect(mockGetWorkspaceQuotaInfo).toHaveBeenCalledWith('ws1', 'user1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: info });
  });

  it('should forward errors to next', async () => {
    const error = new Error('workspace quota error');
    mockGetWorkspaceQuotaInfo.mockRejectedValue(error);

    const req = mockReq({ params: { workspaceId: 'ws1' } });
    const res = mockRes();

    await getWorkspaceQuota(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// linkGitHubEntity
// ═══════════════════════════════════════════════════════════════════════════════

describe('linkGitHubEntity', () => {
  const baseTask = {
    id: 't1',
    createdById: 'user1',
    workspaceId: 'ws1',
    projectId: null,
  };

  it('should link a PR to a task', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue(null);
    const updated = { id: 't1', githubPrUrl: 'https://github.com/org/repo/pull/1' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'pr',
        url: 'https://github.com/org/repo/pull/1',
        number: 1,
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubPrUrl: 'https://github.com/org/repo/pull/1',
        githubPrNumber: 1,
        githubPrStatus: 'open',
        githubRepo: 'org/repo',
      }),
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('should link an issue to a task', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue(null);
    const updated = { id: 't1', githubIssueUrl: 'https://github.com/org/repo/issues/5' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'issue',
        url: 'https://github.com/org/repo/issues/5',
        number: 5,
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubIssueUrl: 'https://github.com/org/repo/issues/5',
        githubIssueNumber: 5,
        githubIssueState: 'open',
        githubRepo: 'org/repo',
      }),
    });
  });

  it('should link a branch to a task', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    const updated = { id: 't1', githubBranchName: 'feature-x' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'branch',
        name: 'feature-x',
        url: 'https://github.com/org/repo/tree/feature-x',
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubBranchName: 'feature-x',
        githubBranchUrl: 'https://github.com/org/repo/tree/feature-x',
        githubRepo: 'org/repo',
      }),
    });
  });

  it('should link a commit to a task', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    const updated = { id: 't1', githubCommitSha: 'abc123' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'commit',
        sha: 'abc123',
        url: 'https://github.com/org/repo/commit/abc123',
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubCommitSha: 'abc123',
        githubCommitUrl: 'https://github.com/org/repo/commit/abc123',
        githubRepo: 'org/repo',
      }),
    });
  });

  it('should throw ValidationError for invalid link type', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'invalid' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('should throw ValidationError for invalid GitHub URL', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://not-github.com/org/repo/pull/1' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid GitHub URL format' }),
    );
  });

  it('should throw ValidationError when PR has no number or URL', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'PR number or URL is required' }),
    );
  });

  it('should throw ValidationError when issue has no number or URL', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'issue' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Issue number or URL is required' }),
    );
  });

  it('should throw ValidationError when branch has no name or URL', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'branch' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch name or URL is required' }),
    );
  });

  it('should throw ValidationError when commit has no sha or URL', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'commit' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Commit SHA or URL is required' }),
    );
  });

  it('should throw ValidationError when task not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: 'nonexistent' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Task not found' }),
    );
  });

  it('should deny access when user is not creator and not a member', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockProjectFindUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to link GitHub entities to this task' }),
    );
  });

  it('should allow access via workspace membership', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockIntegrationFindFirst.mockResolvedValue(null);
    const updated = { id: 't1' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('should allow access via project workspace membership', async () => {
    mockFindUnique.mockResolvedValue({
      id: 't1',
      createdById: 'other-user',
      workspaceId: null,
      projectId: 'proj1',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws1' });
    mockIntegrationFindFirst.mockResolvedValue(null);
    const updated = { id: 't1' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'issue', url: 'https://github.com/org/repo/issues/5', number: 5 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('should deny access when project has no workspaceId', async () => {
    mockFindUnique.mockResolvedValue({
      id: 't1',
      createdById: 'other-user',
      workspaceId: null,
      projectId: 'proj1',
    });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: null });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to link GitHub entities to this task' }),
    );
  });

  it('should auto-complete task when PR is merged', async () => {
    mockFindUnique.mockResolvedValue({ ...baseTask, status: 'IN_PROGRESS' });
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ merged: true, state: 'closed' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const updated = { id: 't1', status: 'COMPLETED' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubPrStatus: 'merged',
        status: 'COMPLETED',
      }),
    });

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'STATUS_CHANGED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: null,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
    });

    vi.unstubAllGlobals();
  });

  it('should not emit an automation event when the PR is not merged', async () => {
    mockFindUnique.mockResolvedValue({ ...baseTask, status: 'TODO' });
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ merged: false, state: 'open' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should detect closed PR state', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ merged: false, state: 'closed' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubPrStatus: 'closed',
      }),
    });

    vi.unstubAllGlobals();
  });

  it('should detect closed issue state', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: 'closed' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'issue', url: 'https://github.com/org/repo/issues/5', number: 5 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubIssueState: 'closed',
      }),
    });

    vi.unstubAllGlobals();
  });

  it('should gracefully handle fetch failure for PR/issue status', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubPrStatus: 'open',
      }),
    });

    vi.unstubAllGlobals();
  });

  it('should not fetch GitHub status when no access token', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue(null);

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should not fetch GitHub status when URL is not provided', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', number: 42 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('should not fetch when response is not ok', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue({
      accessToken: 'ghp_token123',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1', number: 1 },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubPrStatus: 'open',
      }),
    });

    vi.unstubAllGlobals();
  });

  it('should extract repo name from URL', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue(null);
    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'commit',
        sha: 'abc123',
        url: 'https://github.com/my-org/my-repo/commit/abc123',
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubRepo: 'my-org/my-repo',
      }),
    });
  });

  it('should sanitize angle brackets from inputs', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockIntegrationFindFirst.mockResolvedValue(null);
    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: {
        type: 'branch',
        name: '<script>alert(1)</script>',
        url: 'https://github.com/org/repo/tree/<script>',
      },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        githubBranchName: 'scriptalert(1)/script',
      }),
    });
  });

  it('should forward errors to next', async () => {
    const error = new Error('unexpected');
    mockFindUnique.mockRejectedValue(error);

    const req = mockReq({
      params: { id: 't1' },
      body: { type: 'pr', url: 'https://github.com/org/repo/pull/1' },
    });
    const res = mockRes();

    await linkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// linkSlackMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe('linkSlackMessage', () => {
  const baseTask = {
    id: 't1',
    createdById: 'user1',
    workspaceId: 'ws1',
    projectId: null,
  };

  it('should link a Slack message to a task', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    const updated = { id: 't1', slackChannelId: 'C123' };
    mockTaskUpdate.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: 't1' },
      body: {
        channelId: 'C123',
        messageTs: '1234567890.123456',
      },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        slackChannelId: 'C123',
        slackMessageTs: '1234567890.123456',
      },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('should include messageUrl and threadTs when provided', async () => {
    mockFindUnique.mockResolvedValue(baseTask);
    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: {
        channelId: 'C123',
        messageTs: '1234567890.123456',
        messageUrl: 'https://workspace.slack.com/archives/C123/p1234567890123456',
        threadTs: '9876543210.654321',
      },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        slackMessageUrl: 'https://workspace.slack.com/archives/C123/p1234567890123456',
        slackThreadTs: '9876543210.654321',
      }),
    });
  });

  it('should throw ValidationError when channelId is missing', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'channelId and messageTs are required' }),
    );
  });

  it('should throw ValidationError when messageTs is missing', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'channelId and messageTs are required' }),
    );
  });

  it('should throw ValidationError for invalid Slack URL format', async () => {
    const req = mockReq({
      params: { id: 't1' },
      body: {
        channelId: 'C123',
        messageTs: '1234567890.123456',
        messageUrl: 'https://not-slack.com/message',
      },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid Slack message URL format' }),
    );
  });

  it('should throw ValidationError when task not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: 'nonexistent' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Task not found' }),
    );
  });

  it('should deny access when user is not authorized', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockProjectFindUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to link Slack messages to this task' }),
    );
  });

  it('should allow access via workspace membership', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should allow access via project workspace membership', async () => {
    mockFindUnique.mockResolvedValue({
      id: 't1',
      createdById: 'other-user',
      workspaceId: null,
      projectId: 'proj1',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws1' });
    mockTaskUpdate.mockResolvedValue({ id: 't1' });

    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should deny access when project has no workspaceId', async () => {
    mockFindUnique.mockResolvedValue({
      id: 't1',
      createdById: 'other-user',
      workspaceId: null,
      projectId: 'proj1',
    });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: null });

    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to link Slack messages to this task' }),
    );
  });

  it('should forward errors to next', async () => {
    const error = new Error('db error');
    mockFindUnique.mockRejectedValue(error);

    const req = mockReq({
      params: { id: 't1' },
      body: { channelId: 'C123', messageTs: '1234567890.123456' },
    });
    const res = mockRes();

    await linkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// unlinkSlackMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe('unlinkSlackMessage', () => {
  const baseTask = {
    id: 't1',
    createdById: 'user1',
    workspaceId: 'ws1',
    projectId: null,
  };

  it('should unlink Slack message from task', async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseTask)
      .mockResolvedValueOnce({ id: 't1', slackChannelId: null });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 't1', slackChannelId: null },
    });
  });

  it('should throw ValidationError when task not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = mockReq({ params: { id: 'nonexistent' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Task not found' }),
    );
  });

  it('should deny access when user is not authorized', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockProjectFindUnique.mockResolvedValue(null);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to unlink Slack from this task' }),
    );
  });

  it('should allow access via workspace membership', async () => {
    mockFindUnique
      .mockResolvedValueOnce({
        ...baseTask,
        createdById: 'other-user',
      })
      .mockResolvedValueOnce({ id: 't1', slackChannelId: null });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should allow access via project membership', async () => {
    mockFindUnique
      .mockResolvedValueOnce({
        id: 't1',
        createdById: 'other-user',
        workspaceId: null,
        projectId: 'proj1',
      })
      .mockResolvedValueOnce({ id: 't1', slackChannelId: null });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws1' });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should forward errors to next', async () => {
    const error = new Error('db error');
    mockFindUnique.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkSlackMessage(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// unlinkGitHubEntity
// ═══════════════════════════════════════════════════════════════════════════════

describe('unlinkGitHubEntity', () => {
  const baseTask = {
    id: 't1',
    createdById: 'user1',
    workspaceId: 'ws1',
    projectId: null,
  };

  it('should unlink GitHub entity from task', async () => {
    mockFindUnique
      .mockResolvedValueOnce(baseTask)
      .mockResolvedValueOnce({ id: 't1', githubPrUrl: null });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 't1', githubPrUrl: null },
    });
  });

  it('should throw ValidationError when task not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = mockReq({ params: { id: 'nonexistent' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Task not found' }),
    );
  });

  it('should deny access when user is not authorized', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseTask,
      createdById: 'other-user',
    });
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockProjectFindUnique.mockResolvedValue(null);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to unlink GitHub from this task' }),
    );
  });

  it('should allow access via workspace membership', async () => {
    mockFindUnique
      .mockResolvedValueOnce({
        ...baseTask,
        createdById: 'other-user',
      })
      .mockResolvedValueOnce({ id: 't1', githubPrUrl: null });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should allow access via project membership', async () => {
    mockFindUnique
      .mockResolvedValueOnce({
        id: 't1',
        createdById: 'other-user',
        workspaceId: null,
        projectId: 'proj1',
      })
      .mockResolvedValueOnce({ id: 't1', githubPrUrl: null });
    mockWorkspaceMemberFindFirst.mockResolvedValue({ id: 'mem1' });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws1' });
    mockExecuteRaw.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(res.json).toHaveBeenCalled();
  });

  it('should deny access when project has no workspaceId', async () => {
    mockFindUnique.mockResolvedValue({
      id: 't1',
      createdById: 'other-user',
      workspaceId: null,
      projectId: 'proj1',
    });
    mockProjectFindUnique.mockResolvedValue({ workspaceId: null });

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You do not have permission to unlink GitHub from this task' }),
    );
  });

  it('should forward errors to next', async () => {
    const error = new Error('db error');
    mockFindUnique.mockRejectedValue(error);

    const req = mockReq({ params: { id: 't1' } });
    const res = mockRes();

    await unlinkGitHubEntity(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

describe('createTask — automation events', () => {
  beforeEach(() => mockEmitAutomationEvent.mockClear());

  it('should emit TASK_CREATED event when task has workspaceId', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'TASK_CREATED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
    });
  });

  it('should not emit TASK_CREATED when task has no workspaceId', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: null, projectId: null, dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalled();
  });

  it('should emit ASSIGNEE_CHANGED and LABEL_ADDED when assignees and labels are set on create', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: ['user-a'], labelIds: ['label-1'] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'ASSIGNEE_CHANGED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
      addedAssigneeIds: ['user-a'],
    });
    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'LABEL_ADDED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
      addedLabelIds: ['label-1'],
    });
  });

  it('should not emit ASSIGNEE_CHANGED or LABEL_ADDED when none are set on create', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1', dueDate: null };
    mockCreateTask.mockImplementation(async (_data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, assigneeIds: [], labelIds: [] });
      return task;
    });

    const req = mockReq({ body: { title: 'Task' } });
    const res = mockRes();

    await createTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledTimes(1); // TASK_CREATED only
    expect(mockEmitAutomationEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'ASSIGNEE_CHANGED' }),
    );
    expect(mockEmitAutomationEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'LABEL_ADDED' }),
    );
  });
});

describe('updateTask — automation events', () => {
  beforeEach(() => mockEmitAutomationEvent.mockClear());

  const oldTask = {
    title: 'Old', description: null, priority: 'MEDIUM', status: 'TODO', projectId: 'p1',
    dueDate: null, startDate: null, estimatedHours: null,
    focusRequired: null, focusLevel: null, energyType: null, distractionCost: null, intent: null,
    assignees: [], labels: [],
  };

  it('should emit ASSIGNEE_CHANGED and LABEL_ADDED when assignees and labels were added', async () => {
    mockFindUnique.mockResolvedValue(oldTask);
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1' },
        oldStatus: 'TODO',
        newStatus: 'TODO',
        addedAssigneeIds: ['user-a'],
        addedLabelIds: ['label-1'],
      });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { assigneeIds: ['user-a'], labelIds: ['label-1'] } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'ASSIGNEE_CHANGED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
      addedAssigneeIds: ['user-a'],
    });
    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'LABEL_ADDED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: 'p1',
      addedLabelIds: ['label-1'],
    });
  });

  it('should not emit ASSIGNEE_CHANGED or LABEL_ADDED when nothing was added', async () => {
    mockFindUnique.mockResolvedValue(oldTask);
    mockUpdateTask.mockImplementation(async (_id: string, _userId: string, _data: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({
        task: { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: 'p1' },
        oldStatus: 'TODO',
        newStatus: 'TODO',
        addedAssigneeIds: [],
        addedLabelIds: [],
      });
      return {};
    });

    const req = mockReq({ params: { id: 't1' }, body: { title: 'Changed' } });
    const res = mockRes();

    await updateTask(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'ASSIGNEE_CHANGED' }),
    );
    expect(mockEmitAutomationEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'LABEL_ADDED' }),
    );
  });
});

describe('updateTaskStatus — automation events', () => {
  beforeEach(() => mockEmitAutomationEvent.mockClear());

  it('should emit STATUS_CHANGED event when status changes', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: null };
    mockUpdateTaskStatus.mockImplementation(async (_id: unknown, _user: unknown, _status: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'IN_PROGRESS' });
      return task;
    });

    const req = mockReq({ body: { status: 'IN_PROGRESS' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'STATUS_CHANGED',
      taskId: 't1',
      actorId: 'user1',
      workspaceId: 'ws1',
      projectId: null,
      fromStatus: 'TODO',
      toStatus: 'IN_PROGRESS',
    });
  });

  it('should not emit STATUS_CHANGED when status is unchanged', async () => {
    const task = { id: 't1', title: 'Task', workspaceId: 'ws1', projectId: null };
    mockUpdateTaskStatus.mockImplementation(async (_id: unknown, _user: unknown, _status: unknown, callback: (...args: unknown[]) => unknown) => {
      await callback({ task, oldStatus: 'TODO', newStatus: 'TODO' });
      return task;
    });

    const req = mockReq({ body: { status: 'TODO' } });
    const res = mockRes();

    await updateTaskStatus(req as any, res as any, mockNext);

    expect(mockEmitAutomationEvent).not.toHaveBeenCalled();
  });
});
