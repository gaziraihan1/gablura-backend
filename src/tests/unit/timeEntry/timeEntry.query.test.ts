import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { TimeEntryQuery } from '../../../modules/timeEntry/timeEntry.query.js';
import { NotFoundError } from '../../../errors/index.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  addMemberToWorkspace,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('TimeEntryQuery.getTaskEntries', () => {
  it('returns all entries on a task with user info, newest first', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date('2026-08-01T09:00:00.000Z') },
    });
    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 45, startedAt: new Date('2026-08-02T09:00:00.000Z') },
    });

    const entries = await TimeEntryQuery.getTaskEntries(task.id, user.id);

    expect(entries).toHaveLength(2);
    expect(entries[0].duration).toBe(45); // newest first
    expect(entries[0].user.id).toBe(user.id);
  });

  it('returns entries from other members too (task visibility)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: member.id, duration: 25, startedAt: new Date() },
    });

    const entries = await TimeEntryQuery.getTaskEntries(task.id, user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe(member.id);
  });

  it('throws for a user without task access', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);

    await expect(TimeEntryQuery.getTaskEntries(task.id, outsider.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('TimeEntryQuery.getMyEntries', () => {
  it('returns only the requesting user\'s entries', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 60, startedAt: new Date() } });

    const entries = await TimeEntryQuery.getMyEntries(user.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe(user.id);
    expect(entries[0].task.id).toBe(task.id);
  });

  it('filters by date range', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date('2026-08-01T09:00:00.000Z') },
    });
    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 45, startedAt: new Date('2026-08-10T09:00:00.000Z') },
    });

    const entries = await TimeEntryQuery.getMyEntries(user.id, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].duration).toBe(30);
  });

  it('filters with only a from bound', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date('2026-08-01T09:00:00.000Z') },
    });
    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 45, startedAt: new Date('2026-08-10T09:00:00.000Z') },
    });

    const entries = await TimeEntryQuery.getMyEntries(user.id, {
      from: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].duration).toBe(45);
  });

  it('filters with only a to bound', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date('2026-08-01T09:00:00.000Z') },
    });
    await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 45, startedAt: new Date('2026-08-10T09:00:00.000Z') },
    });

    const entries = await TimeEntryQuery.getMyEntries(user.id, {
      to: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].duration).toBe(30);
  });
});
