import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskActivity } from '../../../modules/task/task.activity.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
}));

describe('Task Activity', () => {
  const mockWorkspaceId = 'ws-1';
  const mockWorkspaceSlug = 'test-workspace';
  const mockUserId = 'user-1';
  const mockTaskId = 'task-1';
  const mockTaskTitle = 'Test Task';

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.workspace.findUniqueOrThrow as any).mockResolvedValue({
      slug: mockWorkspaceSlug,
    });
  });

  it('should log task creation activity', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: mockUserId,
      workspaceId: mockWorkspaceId,
      focusRequired: true,
      energyType: 'HIGH',
      intent: 'EXECUTION',
    };

    await TaskActivity.logCreated(params);

    expect(prisma.workspace.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: mockWorkspaceId },
      select: { slug: true },
    });
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: {
        action: 'CREATED',
        entityType: 'TASK',
        entityId: mockTaskId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        workspaceSlug: mockWorkspaceSlug,
        taskId: mockTaskId,
        metadata: {
          taskTitle: mockTaskTitle,
          focusRequired: true,
          energyType: 'HIGH',
          intent: 'EXECUTION',
        },
      },
    });
  });

  it('should log status change activity', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: mockUserId,
      workspaceId: mockWorkspaceId,
      oldStatus: 'TODO',
      newStatus: 'IN_PROGRESS',
    };

    await TaskActivity.logStatusChanged(params);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: {
        action: 'STATUS_CHANGED',
        entityType: 'TASK',
        entityId: mockTaskId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        workspaceSlug: mockWorkspaceSlug,
        taskId: mockTaskId,
        metadata: {
          taskTitle: mockTaskTitle,
          oldStatus: 'TODO',
          newStatus: 'IN_PROGRESS',
        },
      },
    });
  });

  it('should log updated activity', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: mockUserId,
      workspaceId: mockWorkspaceId,
      changes: { priority: 'HIGH' },
    };

    await TaskActivity.logUpdated(params);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: {
        action: 'UPDATED',
        entityType: 'TASK',
        entityId: mockTaskId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        workspaceSlug: mockWorkspaceSlug,
        taskId: mockTaskId,
        metadata: {
          taskTitle: mockTaskTitle,
          changes: { priority: 'HIGH' },
        },
      },
    });
  });

  it('should log deleted activity', async () => {
    const params = {
      taskId: mockTaskId,
      taskTitle: mockTaskTitle,
      userId: mockUserId,
      workspaceId: mockWorkspaceId,
      status: 'COMPLETED',
      priority: 'LOW',
    };

    await TaskActivity.logDeleted(params);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: {
        action: 'DELETED',
        entityType: 'TASK',
        entityId: mockTaskId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        workspaceSlug: mockWorkspaceSlug,
        metadata: {
          taskTitle: mockTaskTitle,
          status: 'COMPLETED',
          priority: 'LOW',
          deletedAt: expect.any(String),
        },
      },
    });
  });

  it('should handle errors gracefully (not throw)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (prisma.workspace.findUniqueOrThrow as any).mockRejectedValue(new Error('DB Error'));

    await TaskActivity.logCreated({
      taskId: '1',
      taskTitle: 'T',
      userId: 'U',
      workspaceId: 'W',
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
