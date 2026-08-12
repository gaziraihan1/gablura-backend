import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskNotifications } from '../../../modules/task/task.notifications.js';
import { prisma } from '../../../lib/prisma.js';
import { notifyUsers } from '../../../modules/notification/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/notification/index.js', () => ({
  notifyUsers: vi.fn(),
}));

describe('Task Notifications', () => {
  const mockUserId = 'user-1';
  const mockUserName = 'Test User';
  const mockTaskId = 'task-1';
  const mockTaskTitle = 'Test Task';

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue({
      name: mockUserName,
    });
    (prisma.user.findMany as any).mockImplementation(({ where }: any) =>
      Promise.resolve((where?.id?.in ?? []).map((id: string) => ({ id }))),
    );
    (prisma.task.findUnique as any).mockResolvedValue({
      title: mockTaskTitle,
      createdById: 'creator-1',
      assignees: [{ userId: 'assignee-1' }],
    });
  });

  it('should notify new assignees excluding creator', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      assigneeIds: ['user-2', 'user-3', mockUserId],
      creatorId: mockUserId,
    };

    await TaskNotifications.notifyNewAssignees(params);

    expect(notifyUsers).toHaveBeenCalledWith([
      {
        userId: 'user-2',
        senderId: mockUserId,
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: `${mockUserName} assigned you a task`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
      {
        userId: 'user-3',
        senderId: mockUserId,
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: `${mockUserName} assigned you a task`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
    ]);
  });

  it('should not notify if only creator is assignee', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      assigneeIds: [mockUserId],
      creatorId: mockUserId,
    };

    await TaskNotifications.notifyNewAssignees(params);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('should notify added assignees excluding updater', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      addedIds: ['user-2', mockUserId],
      updaterId: mockUserId,
    };

    await TaskNotifications.notifyAddedAssignees(params);

    expect(notifyUsers).toHaveBeenCalledWith([
      {
        userId: 'user-2',
        senderId: mockUserId,
        type: 'TASK_ASSIGNED',
        title: 'Task Assigned',
        message: `${mockUserName} assigned you to "${mockTaskTitle}"`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
    ]);
  });

  it('should notify task completion to creator AND assignees excluding the completer', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: 'assignee-1', // the completer is an assignee
    };

    await TaskNotifications.notifyTaskCompleted(params);

    // Creator + the other assignee; completer excluded
    expect(notifyUsers).toHaveBeenCalledWith([
      {
        userId: 'creator-1',
        senderId: 'assignee-1',
        type: 'TASK_COMPLETED',
        title: 'Task Completed',
        message: `Task "${mockTaskTitle}" was completed`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
    ]);
  });

  it('should skip completion notification when the recipient disabled notifications', async () => {
    (prisma.task.findUnique as any).mockResolvedValue({
      title: mockTaskTitle,
      createdById: 'creator-1',
      assignees: [{ userId: 'assignee-1' }],
    });
    (prisma.user.findMany as any).mockResolvedValue([]); // nobody opted in

    await TaskNotifications.notifyTaskCompleted({
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: 'assignee-1',
    });

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('should notify the creator when an assignee completes the task', async () => {
    (prisma.task.findUnique as any).mockResolvedValue({
      title: mockTaskTitle,
      createdById: 'creator-1',
      assignees: [{ userId: 'assignee-1' }],
    });

    await TaskNotifications.notifyTaskCompleted({
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: 'assignee-1',
    });

    expect(notifyUsers).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'creator-1' }),
    ]);
  });

  it('should not notify anyone when only the completer is involved', async () => {
    (prisma.task.findUnique as any).mockResolvedValue({
      title: mockTaskTitle,
      createdById: 'user-1',
      assignees: [],
    });

    await TaskNotifications.notifyTaskCompleted({
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: 'user-1', // creator completes own task, no assignees
    });

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('should notify parent task creator + assignees when a subtask is created', async () => {
    await TaskNotifications.notifySubtaskCreated({
      parentTaskId: mockTaskId,
      subtaskTitle: 'Subtask A',
      creatorId: 'someone-else',
    });

    expect(notifyUsers).toHaveBeenCalledWith([
      {
        userId: 'creator-1',
        senderId: 'someone-else',
        type: 'TASK_COMMENTED',
        title: 'New Subtask',
        message: `A subtask "Subtask A" was added to "${mockTaskTitle}"`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
      {
        userId: 'assignee-1',
        senderId: 'someone-else',
        type: 'TASK_COMMENTED',
        title: 'New Subtask',
        message: `A subtask "Subtask A" was added to "${mockTaskTitle}"`,
        actionUrl: `/dashboard/tasks/${mockTaskId}`,
      },
    ]);
  });

  it('should skip subtask notification when subtask creator is the only stakeholder', async () => {
    (prisma.task.findUnique as any).mockResolvedValue({
      title: mockTaskTitle,
      createdById: 'user-1',
      assignees: [],
    });

    await TaskNotifications.notifySubtaskCreated({
      parentTaskId: mockTaskId,
      subtaskTitle: 'Subtask A',
      creatorId: 'user-1',
    });

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully in all methods', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (prisma.user.findUnique as any).mockRejectedValue(new Error('DB Error'));
    (prisma.task.findUnique as any).mockRejectedValue(new Error('DB Error'));

    await TaskNotifications.notifyNewAssignees({
      taskId: '1', taskTitle: 'T', assigneeIds: ['2'], creatorId: '1'
    });
    await TaskNotifications.notifyTaskCompleted({
      taskId: '1', taskTitle: 'T', userId: '1'
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
