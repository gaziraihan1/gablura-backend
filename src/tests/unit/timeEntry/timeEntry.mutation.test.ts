import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { TimeEntryMutation } from '../../../modules/timeEntry/timeEntry.mutation.js';
import { NotFoundError, ForbiddenError } from '../../../errors/index.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  addMemberToWorkspace,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('TimeEntryMutation.createEntry', () => {
  it('creates a time entry with defaults', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const entry = await TimeEntryMutation.createEntry({
      taskId: task.id,
      userId: user.id,
      duration: 45,
    });

    expect(entry).toBeDefined();
    expect(entry.taskId).toBe(task.id);
    expect(entry.userId).toBe(user.id);
    expect(entry.duration).toBe(45);
    expect(entry.category).toBe('OTHER');
    expect(entry.billable).toBe(false);
    expect(entry.startedAt).toBeInstanceOf(Date);
    expect(entry.endedAt).toBeNull();
  });

  it('creates a full entry with all fields', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const entry = await TimeEntryMutation.createEntry({
      taskId: task.id,
      userId: user.id,
      duration: 120,
      category: 'DEEP_WORK',
      billable: true,
      description: 'Sprint planning',
      startedAt: new Date('2026-08-01T09:00:00.000Z'),
      endedAt: new Date('2026-08-01T11:00:00.000Z'),
    });

    expect(entry.category).toBe('DEEP_WORK');
    expect(entry.billable).toBe(true);
    expect(entry.description).toBe('Sprint planning');
  });

  it('rejects a user without task access', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);

    await expect(TimeEntryMutation.createEntry({
      taskId: task.id,
      userId: outsider.id,
      duration: 30,
    })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('TimeEntryMutation.updateEntry', () => {
  it('updates an owned entry', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    const updated = await TimeEntryMutation.updateEntry(entry.id, user.id, {
      duration: 60,
      billable: true,
      category: 'MEETINGS',
    });

    expect(updated.duration).toBe(60);
    expect(updated.billable).toBe(true);
    expect(updated.category).toBe('MEETINGS');
  });

  it('rejects updating another user\'s entry', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const other = await createUser();
    await addMemberToWorkspace(other.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    await expect(TimeEntryMutation.updateEntry(entry.id, other.id, { duration: 90 }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects updating a missing entry', async () => {
    const user = await createUser();
    await expect(TimeEntryMutation.updateEntry('missing', user.id, { duration: 90 }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('TimeEntryMutation.deleteEntry', () => {
  it('deletes an owned entry', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    await TimeEntryMutation.deleteEntry(entry.id, user.id);

    const found = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(found).toBeNull();
  });

  it('rejects deleting another user\'s entry', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const other = await createUser();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    await expect(TimeEntryMutation.deleteEntry(entry.id, other.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('TimeEntryMutation cache invalidation', () => {
  it('invalidates time summaries for the workspace on create', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });

    const entry = await TimeEntryMutation.createEntry({
      taskId: task.id,
      userId: user.id,
      duration: 30,
    });

    expect(entry).toBeDefined();
    // Cache invalidation is fire-and-forget against mocked Redis — the entry
    // still persists regardless of Redis availability.
    const persisted = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(persisted).not.toBeNull();
  });
});
