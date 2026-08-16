import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { TimeEntryAccess } from '../../../modules/timeEntry/timeEntry.access.js';
import { NotFoundError, ForbiddenError } from '../../../errors/index.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  addMemberToWorkspace,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('TimeEntryAccess.assertTaskAccess', () => {
  it('allows the task creator', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const result = await TimeEntryAccess.assertTaskAccess(task.id, user.id);
    expect(result.id).toBe(task.id);
  });

  it('allows a workspace owner', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const other = await createUser();
    const task = await createTask(workspace.id, other.id);

    await expect(TimeEntryAccess.assertTaskAccess(task.id, user.id)).resolves.toBeDefined();
  });

  it('allows a workspace admin', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const other = await createUser();
    const task = await createTask(workspace.id, other.id);

    await expect(TimeEntryAccess.assertTaskAccess(task.id, admin.id)).resolves.toBeDefined();
  });

  it('allows a project member', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.id },
    });
    const task = await createTask(workspace.id, user.id, { projectId: project.id });

    await expect(TimeEntryAccess.assertTaskAccess(task.id, member.id)).resolves.toBeDefined();
  });

  it('rejects a user with no access to the task', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);

    await expect(TimeEntryAccess.assertTaskAccess(task.id, outsider.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-existent task', async () => {
    const user = await createUser();
    await expect(TimeEntryAccess.assertTaskAccess('missing-task', user.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('TimeEntryAccess.assertEntryOwnership', () => {
  it('allows the entry author', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    const result = await TimeEntryAccess.assertEntryOwnership(entry.id, user.id);
    expect(result.id).toBe(entry.id);
  });

  it('rejects a different user', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const other = await createUser();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });

    await expect(TimeEntryAccess.assertEntryOwnership(entry.id, other.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a non-existent entry', async () => {
    const user = await createUser();
    await expect(TimeEntryAccess.assertEntryOwnership('missing-entry', user.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
