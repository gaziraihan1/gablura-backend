import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { ActivityMutation } from '../../../modules/activity/activity.mutation.js';
import {
  createWorkspaceWithOwner,
  createUser,
  createTask,
} from '../../factories/index.js';
import { ActivityType, EntityType } from '@prisma/client';

function now() {
  return new Date();
}

describe('ActivityMutation.createActivity', () => {
  it('creates an activity successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const task = await createTask(workspace.id, user.id);

    const result = await ActivityMutation.createActivity({
      action: ActivityType.CREATED,
      entityType: EntityType.TASK,
      entityId: task.id,
      userId: user.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      taskId: task.id,
      metadata: { test: true },
    });

    expect(result).toBeDefined();
    expect(result.userId).toBe(user.id);
    expect(result.workspaceId).toBe(workspace.id);
    expect(result.entityId).toBe(task.id);
    expect(result.metadata).toMatchObject({ test: true });
  });

  it('creates activity with default metadata when not provided', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await ActivityMutation.createActivity({
      action: ActivityType.CREATED,
      entityType: EntityType.TASK,
      entityId: 'random-id',
      userId: user.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
    });

    expect(result.metadata).toEqual({});
  });
});

describe('ActivityMutation.deleteActivity', () => {
  it('deletes an activity successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const activity = await prisma.activity.create({
      data: {
        action: ActivityType.CREATED,
        entityType: EntityType.TASK,
        entityId: 'test-id',
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {},
      },
    });

    await ActivityMutation.deleteActivity(activity.id, user.id);

    const found = await prisma.activity.findUnique({
      where: { id: activity.id },
    });

    expect(found).toBeNull();
  });

  it('throws if user has no permission', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const user1 = await createUser();
    const user2 = await createUser();

    const activity = await prisma.activity.create({
      data: {
        action: ActivityType.CREATED,
        entityType: EntityType.TASK,
        entityId: 'test-id',
        userId: user1.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        metadata: {},
      },
    });

    await expect(
      ActivityMutation.deleteActivity(activity.id, user2.id),
    ).rejects.toThrow();
  });
});

describe('ActivityMutation.clearUserActivities', () => {
  it('clears all user activities', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    await prisma.activity.createMany({
      data: [
        {
          action: ActivityType.CREATED,
          entityType: EntityType.TASK,
          entityId: '1',
          userId: user.id,
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
        },
        {
          action: ActivityType.UPDATED,
          entityType: EntityType.TASK,
          entityId: '2',
          userId: user.id,
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
        },
      ],
    });

    const deleted = await ActivityMutation.clearUserActivities(user.id);

    expect(deleted).toBe(2);

    const remaining = await prisma.activity.findMany({
      where: { userId: user.id },
    });

    expect(remaining.length).toBe(0);
  });

  it('clears only workspace filtered activities', async () => {
    const { user } = await createWorkspaceWithOwner();
    const ws2 = await createWorkspaceWithOwner();

    const activity1 = await prisma.activity.create({
      data: {
        action: ActivityType.CREATED,
        entityType: EntityType.TASK,
        entityId: '1',
        userId: user.id,
        workspaceId: ws2.workspace.id,
        workspaceSlug: ws2.workspace.slug,
      },
    });

    await prisma.activity.create({
      data: {
        action: ActivityType.CREATED,
        entityType: EntityType.TASK,
        entityId: '2',
        userId: user.id,
        workspaceId: ws2.workspace.id,
        workspaceSlug: ws2.workspace.slug,
      },
    });

    const deleted = await ActivityMutation.clearUserActivities(user.id, {
      workspaceId: ws2.workspace.id,
    });

    expect(deleted).toBe(2);
  });

  it('clears only activities before date', async () => {
  const { user, workspace } = await createWorkspaceWithOwner();

  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 5);

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 1); // IMPORTANT FIX

  await prisma.activity.create({
    data: {
      action: ActivityType.CREATED,
      entityType: EntityType.TASK,
      entityId: 'old',
      userId: user.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      createdAt: oldDate,
    },
  });

  await prisma.activity.create({
    data: {
      action: ActivityType.CREATED,
      entityType: EntityType.TASK,
      entityId: 'new',
      userId: user.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      createdAt: futureDate, // 👈 key fix
    },
  });

  const deleted = await ActivityMutation.clearUserActivities(user.id, {
    before: now(),
  });

  expect(deleted).toBe(1);

  const remaining = await prisma.activity.findMany({
    where: { userId: user.id },
  });

  expect(remaining.length).toBe(1);
});
});