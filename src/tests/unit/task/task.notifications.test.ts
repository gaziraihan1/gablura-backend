import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskNotifications } from '../../../modules/task/task.notifications.js';
import { prisma } from '../../../lib/prisma.js';
import { notifyUsers, notifyTaskAssignees, notifyMentions } from '../../../modules/notification/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/notification/index.js', () => ({
  notifyUsers: vi.fn(),
  notifyTaskAssignees: vi.fn(),
  notifyMentions: vi.fn(),
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

  it('should notify task completion', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: mockUserId,
    };

    await TaskNotifications.notifyTaskCompleted(params);

    expect(notifyTaskAssignees).toHaveBeenCalledWith({
      taskId: mockTaskId,
      senderId: mockUserId,
      type: 'TASK_COMPLETED',
      title: 'Task Completed',
      message: `Task "${mockTaskTitle}" was completed`,
      excludeUserId: mockUserId,
    });
  });

  it('should notify new comment', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      commenterId: mockUserId,
      commenterName: mockUserName,
    };

    await TaskNotifications.notifyNewComment(params);

    expect(notifyTaskAssignees).toHaveBeenCalledWith({
      taskId: mockTaskId,
      senderId: mockUserId,
      type: 'TASK_COMMENTED',
      title: 'New Comment',
      message: `${mockUserName} commented on "${mockTaskTitle}"`,
      excludeUserId: mockUserId,
    });
  });

  it('should notify comment mentions', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      commentText: '@user-2 check this',
      workspaceId: 'ws-1',
      senderId: mockUserId,
      senderName: mockUserName,
    };

    await TaskNotifications.notifyCommentMentions(params);

    expect(notifyMentions).toHaveBeenCalledWith({
      text: params.commentText,
      workspaceId: params.workspaceId,
      senderId: params.senderId,
      senderName: params.senderName,
      context: `task "${mockTaskTitle}"`,
      actionUrl: `/dashboard/tasks/${mockTaskId}`,
    });
  });

  it('should handle errors gracefully in all methods', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (prisma.user.findUnique as any).mockRejectedValue(new Error('DB Error'));

    await TaskNotifications.notifyNewAssignees({
      taskId: '1', taskTitle: 'T', assigneeIds: ['2'], creatorId: '1'
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
