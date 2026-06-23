import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { DailyTaskMutation } from '../../../modules/dailyTask/dailyTask.mutation.js';
import {
  createWorkspaceWithOwner,
  createTask,
} from '../../factories/index.js';

function today() {
  return new Date();
}

describe('DailyTaskMutation.addDailyTask', () => {
  it('creates a new daily task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(
      workspace.id,
      user.id,
      { status: 'TODO' }
    );

    const result = await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'PRIMARY',
      date: today(),
    });

    expect(result).toBeDefined();
    expect(result.taskId).toBe(task.id);
    expect(result.type).toBe('PRIMARY');
  });

  it('prevents adding completed task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(
      workspace.id,
      user.id,
      { status: 'COMPLETED' }
    );

    await expect(
      DailyTaskMutation.addDailyTask({
        userId: user.id,
        taskId: task.id,
        type: 'PRIMARY',
        date: today(),
      }),
    ).rejects.toThrow('Cannot add a completed task to daily tasks');
  });

  it('prevents duplicate PRIMARY task in same day', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task1 = await createTask(workspace.id, user.id);
    const task2 = await createTask(workspace.id, user.id);

    await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task1.id,
      type: 'PRIMARY',
      date: today(),
    });

    await expect(
      DailyTaskMutation.addDailyTask({
        userId: user.id,
        taskId: task2.id,
        type: 'PRIMARY',
        date: today(),
      }),
    ).rejects.toThrow('primary task');
  });

  it('returns existing if same task + same type', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(workspace.id, user.id);

    const first = await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'SECONDARY',
      date: today(),
    });

    const second = await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'SECONDARY',
      date: today(),
    });

    expect(second.id).toBe(first.id);
  });

  it('updates type if same task exists with different type', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(workspace.id, user.id);

    const first = await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'SECONDARY',
      date: today(),
    });

    const updated = await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'PRIMARY',
      date: today(),
    });

    expect(updated.id).toBe(first.id);
    expect(updated.type).toBe('PRIMARY');
  });
});

describe('DailyTaskMutation.removeDailyTask', () => {
  it('removes an existing daily task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(workspace.id, user.id);

    await DailyTaskMutation.addDailyTask({
      userId: user.id,
      taskId: task.id,
      type: 'PRIMARY',
      date: today(),
    });

    await DailyTaskMutation.removeDailyTask({
      userId: user.id,
      taskId: task.id,
      date: today(),
    });

    const found = await prisma.dailyTask.findFirst({
      where: {
        userId: user.id,
        taskId: task.id,
      },
    });

    expect(found).toBeNull();
  });

  it('throws if daily task not found', async () => {
    const { user } = await createWorkspaceWithOwner();

    await expect(
      DailyTaskMutation.removeDailyTask({
        userId: user.id,
        taskId: 'non-existent-id',
        date: today(),
      }),
    ).rejects.toThrow('Daily task not found');
  });
});

describe('DailyTaskMutation.clearExpiredDailyTasks', () => {
  it('deletes only expired tasks', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(workspace.id, user.id);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const todayDate = new Date();

    await prisma.dailyTask.create({
      data: {
        userId: user.id,
        taskId: task.id,
        type: 'SECONDARY',
        date: yesterday,
      },
    });

    await prisma.dailyTask.create({
      data: {
        userId: user.id,
        taskId: task.id,
        type: 'SECONDARY',
        date: todayDate,
      },
    });

    const result = await DailyTaskMutation.clearExpiredDailyTasks();

    expect(result.deletedCount).toBe(1);

    const remaining = await prisma.dailyTask.findMany({
      where: { userId: user.id },
    });

    expect(remaining.length).toBe(1);
  });
});