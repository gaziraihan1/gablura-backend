import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { LabelAccess } from '../../../modules/label/label.access.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../errors/index.js';
import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
  createLabel,
  createTask,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('LabelAccess.assertLabelAccess', () => {
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

    const result = await LabelAccess.assertLabelAccess(label.id, user.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
  });

  it('allows workspace member to access workspace label', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelAccess.assertLabelAccess(label.id, member.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
  });

  it('throws NotFoundError when label does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelAccess.assertLabelAccess('non-existent-id', user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-member tries to access workspace label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const outsider = await createUser();

    await expect(
      LabelAccess.assertLabelAccess(label.id, outsider.id)
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when non-creator tries to access personal label', async () => {
    const user1 = await createUser();
    const user2 = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user1.id,
        workspaceId: null,
      },
    });

    await expect(
      LabelAccess.assertLabelAccess(label.id, user2.id)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows workspace owner to access any label in workspace', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, member.id);

    const result = await LabelAccess.assertLabelAccess(label.id, owner.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(label.id);
  });
});

describe('LabelAccess.canEditLabel', () => {
  it('returns true for creator of personal label', async () => {
    const user = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user.id,
        workspaceId: null,
      },
    });

    const result = await LabelAccess.canEditLabel(label, user.id);

    expect(result).toBe(true);
  });

  it('returns false for non-creator of personal label', async () => {
    const user1 = await createUser();
    const user2 = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user1.id,
        workspaceId: null,
      },
    });

    const result = await LabelAccess.canEditLabel(label, user2.id);

    expect(result).toBe(false);
  });

  it('returns true for workspace owner', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    const label = await createLabel(workspace.id, member.id);

    const result = await LabelAccess.canEditLabel(label, owner.id);

    expect(result).toBe(true);
  });

  it('returns true for workspace admin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelAccess.canEditLabel(label, admin.id);

    expect(result).toBe(true);
  });

  it('returns false for regular member who did not create label', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelAccess.canEditLabel(label, member.id);

    expect(result).toBe(false);
  });

  it('returns true for creator of workspace label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelAccess.canEditLabel(label, user.id);

    expect(result).toBe(true);
  });
});

describe('LabelAccess.assertNoDuplicateName', () => {
  it('throws ConflictError for duplicate name in workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'Bug' });

    await expect(
      LabelAccess.assertNoDuplicateName('Bug', workspace.id, user.id)
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError for duplicate personal label name', async () => {
    const user = await createUser();
    await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user.id,
        workspaceId: null,
      },
    });

    await expect(
      LabelAccess.assertNoDuplicateName('Personal', null, user.id)
    ).rejects.toThrow(ConflictError);
  });

  it('allows same name in different workspaces', async () => {
    const { user: u1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    await createLabel(ws1.id, u1.id, { name: 'Urgent' });

    await expect(
      LabelAccess.assertNoDuplicateName('Urgent', ws2.id, u2.id)
    ).resolves.not.toThrow();
  });

  it('allows same name for different users personal labels', async () => {
    const user1 = await createUser();
    const user2 = await createUser();
    await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user1.id,
        workspaceId: null,
      },
    });

    await expect(
      LabelAccess.assertNoDuplicateName('Personal', null, user2.id)
    ).resolves.not.toThrow();
  });

  it('excludes specified labelId from duplicate check', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { name: 'Bug' });

    await expect(
      LabelAccess.assertNoDuplicateName('Bug', workspace.id, user.id, label.id)
    ).resolves.not.toThrow();
  });

  it('name comparison is case-insensitive', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'bug' });

    await expect(
      LabelAccess.assertNoDuplicateName('BUG', workspace.id, user.id)
    ).rejects.toThrow(ConflictError);
  });

  it('allows new name when updating existing label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label1 = await createLabel(workspace.id, user.id, { name: 'Bug' });
    const label2 = await createLabel(workspace.id, user.id, { name: 'Feature' });

    await expect(
      LabelAccess.assertNoDuplicateName('Feature', workspace.id, user.id, label1.id)
    ).rejects.toThrow(ConflictError);
  });
});

describe('LabelAccess.assertTaskAccess', () => {
  it('allows task creator to access task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const result = await LabelAccess.assertTaskAccess(task.id, user.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(task.id);
  });

  it('allows task assignee to access task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const assignee = await createUser();
    const task = await createTask(workspace.id, user.id);

    await prisma.taskAssignee.create({
      data: { taskId: task.id, userId: assignee.id },
    });

    const result = await LabelAccess.assertTaskAccess(task.id, assignee.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(task.id);
  });

  it('allows workspace owner to access task', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, owner.id);

    const result = await LabelAccess.assertTaskAccess(task.id, owner.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(task.id);
  });

  it('allows workspace admin to access task', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, owner.id); // Create task first
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const result = await LabelAccess.assertTaskAccess(task.id, admin.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(task.id);
  });

  it('allows project member to access task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { createProject } = await import('../../factories/index.js');
    const project = await createProject(workspace.id, user.id);
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.id },
    });
    const task = await createTask(workspace.id, user.id, { projectId: project.id });

    const result = await LabelAccess.assertTaskAccess(task.id, member.id);

    expect(result).toBeDefined();
    expect(result.id).toBe(task.id);
  });

  it('throws NotFoundError when task does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelAccess.assertTaskAccess('non-existent-id', user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when user has no access to task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const outsider = await createUser();

    await expect(
      LabelAccess.assertTaskAccess(task.id, outsider.id)
    ).rejects.toThrow(NotFoundError);
  });
});

describe('LabelAccess.accessibleTaskIds', () => {
  it('returns empty set for empty input', async () => {
    const user = await createUser();

    const result = await LabelAccess.accessibleTaskIds([], user.id);

    expect(result).toEqual(new Set());
  });

  it('returns accessible task ids for task creator', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task1 = await createTask(workspace.id, user.id);
    const task2 = await createTask(workspace.id, user.id);

    const result = await LabelAccess.accessibleTaskIds(
      [task1.id, task2.id],
      user.id
    );

    expect(result).toEqual(new Set([task1.id, task2.id]));
  });

  it('filters out inaccessible task ids', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task1 = await createTask(workspace.id, user.id);
    
    // Create a task in a workspace where 'user' is NOT a member
    const { user: otherUser, workspace: otherWorkspace } = await createWorkspaceWithOwner();
    const task2 = await createTask(otherWorkspace.id, otherUser.id);

    const result = await LabelAccess.accessibleTaskIds(
      [task1.id, task2.id],
      user.id
    );

    expect(result.has(task1.id)).toBe(true);
    expect(result.has(task2.id)).toBe(false);
  });

  it('includes tasks where user is assignee', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const assignee = await createUser();
    const task = await createTask(workspace.id, user.id);

    await prisma.taskAssignee.create({
      data: { taskId: task.id, userId: assignee.id },
    });

    const result = await LabelAccess.accessibleTaskIds([task.id], assignee.id);

    expect(result.has(task.id)).toBe(true);
  });

  it('includes tasks from workspace where user is admin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, owner.id); // Create task first
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const result = await LabelAccess.accessibleTaskIds([task.id], admin.id);

    expect(result.has(task.id)).toBe(true);
  });

  it('includes tasks from project where user is manager', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { createProject } = await import('../../factories/index.js');
    const project = await createProject(workspace.id, user.id);
    const manager = await createUser();
    await addMemberToWorkspace(manager.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: manager.id, role: 'MANAGER' },
    });
    const task = await createTask(workspace.id, user.id, { projectId: project.id });

    const result = await LabelAccess.accessibleTaskIds([task.id], manager.id);

    expect(result.has(task.id)).toBe(true);
  });
});

describe('LabelAccess.canManageLabel', () => {
  it('returns true for creator of personal label', async () => {
    const user = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user.id,
        workspaceId: null,
      },
    });

    const result = await LabelAccess.canManageLabel(label, user.id);

    expect(result).toBe(true);
  });

  it('returns false for non-creator of personal label', async () => {
    const user1 = await createUser();
    const user2 = await createUser();
    const label = await prisma.label.create({
      data: {
        name: 'Personal',
        color: '#ff0000',
        createdById: user1.id,
        workspaceId: null,
      },
    });

    const result = await LabelAccess.canManageLabel(label, user2.id);

    expect(result).toBe(false);
  });

  it('returns true for workspace owner', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    const label = await createLabel(workspace.id, member.id);

    const result = await LabelAccess.canManageLabel(label, owner.id);

    expect(result).toBe(true);
  });

  it('returns true for workspace admin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelAccess.canManageLabel(label, admin.id);

    expect(result).toBe(true);
  });

  it('returns false for regular member who did not create label', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    const result = await LabelAccess.canManageLabel(label, member.id);

    expect(result).toBe(false);
  });

  it('returns true for creator of workspace label', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelAccess.canManageLabel(label, user.id);

    expect(result).toBe(true);
  });
});
