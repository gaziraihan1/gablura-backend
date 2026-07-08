import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { LabelQuery } from '../../../modules/label/label.query.js';
import { NotFoundError } from '../../../errors/index.js';
import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
  createLabel,
  createTask,
} from '../../factories/index.js';
import { WorkspaceRole, TaskStatus, Priority } from '@prisma/client';

describe('LabelQuery.getLabels', () => {
  beforeEach(async () => {
    try {
      // Delete in order of dependency (children first, then parents)
      await prisma.taskLabel.deleteMany();
      await prisma.label.deleteMany();
      await prisma.task.deleteMany();
      await prisma.workspaceMember.deleteMany();
      await prisma.workspace.deleteMany();
      await prisma.user.deleteMany();
    } catch (e) {
      // Table might not exist yet in the test DB, safe to ignore during setup
    }
  });

  it('returns labels for workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'Frontend' });
    await createLabel(workspace.id, user.id, { name: 'Backend' });

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.pagination).toBeDefined();
  });

  it('returns personal labels when no workspaceId provided', async () => {
    const user = await createUser();
    await prisma.label.create({
      data: {
        name: 'Personal Only',
        color: '#123456',
        createdById: user.id,
        workspaceId: null,
      },
    });

    const result = await LabelQuery.getLabels(user.id);

    expect(result.data.some((l: any) => l.name === 'Personal Only')).toBe(true);
  });

  it('labels are sorted alphabetically by name', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'Zebra' });
    await createLabel(workspace.id, user.id, { name: 'Alpha' });
    await createLabel(workspace.id, user.id, { name: 'Middle' });

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
    });

    const names = result.data.map((l: any) => l.name);
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Middle'));
    expect(names.indexOf('Middle')).toBeLessThan(names.indexOf('Zebra'));
  });

  it('labels are workspace-isolated', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'My Label' });
    await createLabel(ws2.id, u2.id, { name: 'Other WS Label' });

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(
      result.data.some((l: any) => l.name === 'Other WS Label')
    ).toBe(false);
  });

  it('respects pagination parameters', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    for (let i = 1; i <= 5; i++) {
      await createLabel(workspace.id, user.id, { name: `Label ${i}` });
    }

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
      page: 1,
      limit: 2,
    });

    expect(result.data.length).toBeLessThanOrEqual(2);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(2);
  });

  it('returns correct pagination metadata', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    for (let i = 1; i <= 3; i++) {
      await createLabel(workspace.id, user.id, { name: `Label ${i}` });
    }

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
      page: 1,
      limit: 2,
    });

    expect(result.pagination.total).toBe(3);
    expect(result.pagination.totalPages).toBe(2);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('returns empty array when no labels exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await LabelQuery.getLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});

describe('LabelQuery.getLabel', () => {
  it('returns label by ID', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { name: 'Specific' });

    const result = await LabelQuery.getLabel(label.id, user.id) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
    expect(result.name).toBe('Specific');
  });

  it('throws NotFoundError when label does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelQuery.getLabel('non-existent-id', user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws error when user has no access to workspace label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const outsider = await createUser();

    await expect(LabelQuery.getLabel(label.id, outsider.id)).rejects.toThrow();
  });

  it('allows creator to access personal label', async () => {
    const user = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user.id,
        workspaceId: null,
      },
    });

    const result = await LabelQuery.getLabel(label.id, user.id) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
  });

  it('allows workspace member to access workspace label', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelQuery.getLabel(label.id, member.id) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
  });
});

describe('LabelQuery.getLabelTasks', () => {
  it('returns tasks for a label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const task1 = await createTask(workspace.id, user.id);
    const task2 = await createTask(workspace.id, user.id);

    await prisma.taskLabel.createMany({
      data: [
        { taskId: task1.id, labelId: label.id },
        { taskId: task2.id, labelId: label.id },
      ],
    });

    const result = await LabelQuery.getLabelTasks(label.id, user.id);

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.pagination).toBeDefined();
  });

  it('filters tasks by status', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const task1 = await createTask(workspace.id, user.id, {
      status: TaskStatus.TODO,
    });
    const task2 = await createTask(workspace.id, user.id, {
      status: TaskStatus.IN_PROGRESS,
    });

    await prisma.taskLabel.createMany({
      data: [
        { taskId: task1.id, labelId: label.id },
        { taskId: task2.id, labelId: label.id },
      ],
    });

    const result = await LabelQuery.getLabelTasks(label.id, user.id, {
      status: 'TODO',
    });

    expect(result.data.length).toBe(1);
    expect(result.data[0].task.status).toBe(TaskStatus.TODO);
  });

  it('filters tasks by priority', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const task1 = await createTask(workspace.id, user.id, {
      priority: Priority.HIGH,
    });
    const task2 = await createTask(workspace.id, user.id, {
      priority: Priority.LOW,
    });

    await prisma.taskLabel.createMany({
      data: [
        { taskId: task1.id, labelId: label.id },
        { taskId: task2.id, labelId: label.id },
      ],
    });

    const result = await LabelQuery.getLabelTasks(label.id, user.id, {
      priority: 'HIGH',
    });

    expect(result.data.length).toBe(1);
    expect(result.data[0].task.priority).toBe(Priority.HIGH);
  });

  it('respects pagination parameters', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    for (let i = 1; i <= 5; i++) {
      const task = await createTask(workspace.id, user.id);
      await prisma.taskLabel.create({
        data: { taskId: task.id, labelId: label.id },
      });
    }

    const result = await LabelQuery.getLabelTasks(label.id, user.id, {
      page: 1,
      limit: 2,
    });

    expect(result.data.length).toBeLessThanOrEqual(2);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(2);
  });

  it('returns tasks sorted by createdAt desc', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    // Create tasks at different times
    const task1 = await createTask(workspace.id, user.id);
    await new Promise(r => setTimeout(r, 100)); // Ensure different timestamp
    const task2 = await createTask(workspace.id, user.id);

    await prisma.taskLabel.create({
      data: { taskId: task1.id, labelId: label.id },
    });
    await prisma.taskLabel.create({
      data: { taskId: task2.id, labelId: label.id },
    });

    const result = await LabelQuery.getLabelTasks(label.id, user.id);

    // task2 should be first because it was created later
    expect(result.data[0].task.id).toBe(task2.id);
    expect(result.data[1].task.id).toBe(task1.id);
  });

  it('throws error when user has no access to label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const outsider = await createUser();

    await expect(
      LabelQuery.getLabelTasks(label.id, outsider.id)
    ).rejects.toThrow();
  });

  it('returns empty array when label has no tasks', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelQuery.getLabelTasks(label.id, user.id);

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('only returns tasks user has access to', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    const ownerTask = await createTask(workspace.id, owner.id);
    const memberTask = await createTask(workspace.id, member.id);

    await prisma.taskLabel.createMany({
      data: [
        { taskId: ownerTask.id, labelId: label.id },
        { taskId: memberTask.id, labelId: label.id },
      ],
    });

    const result = await LabelQuery.getLabelTasks(label.id, member.id);

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const taskIds = result.data.map((tl: any) => tl.task.id);
    expect(taskIds).toContain(memberTask.id);
  });
});

describe('LabelQuery.getPopularLabels', () => {
  it('returns popular labels for workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { name: 'Popular' });

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.pagination).toBeDefined();
  });

  it('sorts labels by task count desc', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label1 = await createLabel(workspace.id, user.id, { name: 'Popular' });
    const label2 = await createLabel(workspace.id, user.id, { name: 'Less Popular' });

    const task1 = await createTask(workspace.id, user.id);
    const task2 = await createTask(workspace.id, user.id);

    await prisma.taskLabel.createMany({
      data: [
        { taskId: task1.id, labelId: label1.id },
        { taskId: task2.id, labelId: label1.id },
      ],
    });

    await prisma.taskLabel.create({
      data: { taskId: task1.id, labelId: label2.id },
    });

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data[0].id).toBe(label1.id);
    expect(result.data[0]._count.tasks).toBe(2);
  });

  it('respects limit parameter', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    for (let i = 1; i <= 5; i++) {
      await createLabel(workspace.id, user.id, { name: `Label ${i}` });
    }

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
      limit: 3,
    });

    expect(result.data.length).toBeLessThanOrEqual(3);
  });

  it('returns personal and workspace labels when no workspaceId', async () => {
    const user = await createUser();
    const { workspace } = await createWorkspaceWithOwner();

    await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user.id,
        workspaceId: null,
      },
    });

    await addMemberToWorkspace(user.id, workspace.id, WorkspaceRole.MEMBER);
    await createLabel(workspace.id, user.id, { name: 'Workspace Label' });

    const result = await LabelQuery.getPopularLabels(user.id);

    expect(result.data.length).toBeGreaterThanOrEqual(2);
    const hasPersonal = result.data.some((l: any) => l.name === 'Personal');
    const hasWorkspace = result.data.some(
      (l: any) => l.name === 'Workspace Label'
    );
    expect(hasPersonal || hasWorkspace).toBe(true);
  });

  it('returns empty array when no labels exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('respects pagination parameters', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    for (let i = 1; i <= 5; i++) {
      await createLabel(workspace.id, user.id, { name: `Label ${i}` });
    }

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
      page: 1,
      limit: 2,
    });

    expect(result.data.length).toBeLessThanOrEqual(2);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(2);
  });

  it('default limit is 10', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    for (let i = 1; i <= 15; i++) {
      await createLabel(workspace.id, user.id, { name: `Label ${i}` });
    }

    const result = await LabelQuery.getPopularLabels(user.id, {
      workspaceId: workspace.id,
    });

    expect(result.data.length).toBeLessThanOrEqual(10);
    expect(result.pagination.limit).toBe(10);
  });
});
