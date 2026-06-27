import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { LabelMutation } from '../../../modules/label/label.mutation.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../errors/index.js';
import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
  createLabel,
  createTask,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

describe('LabelMutation.createLabel', () => {
  it('creates a workspace label successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await LabelMutation.createLabel({
      name: 'Bug',
      color: '#ff0000',
      description: 'Bug reports',
      workspaceId: workspace.id,
      createdById: user.id,
    });

    expect(result).toBeDefined();
    expect(result.name).toBe('Bug');
    expect(result.color).toBe('#ff0000');
    expect(result.description).toBe('Bug reports');
    expect(result.workspaceId).toBe(workspace.id);
    expect(result.createdById).toBe(user.id);
  });

  it('creates a personal label (no workspace)', async () => {
    const user = await createUser();

    const result = await LabelMutation.createLabel({
      name: 'Personal',
      color: '#00ff00',
      createdById: user.id,
    });

    expect(result).toBeDefined();
    expect(result.name).toBe('Personal');
    expect(result.workspaceId).toBeNull();
    expect(result.createdById).toBe(user.id);
  });

  it('throws NotFoundError when workspace does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelMutation.createLabel({
        name: 'Test',
        color: '#ff0000',
        workspaceId: 'non-existent-workspace-id',
        createdById: user.id,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-owner creates workspace label', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    await expect(
      LabelMutation.createLabel({
        name: 'Test',
        color: '#ff0000',
        workspaceId: workspace.id,
        createdById: outsider.id,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows admin to create workspace label', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const result = await LabelMutation.createLabel({
      name: 'Admin Label',
      color: '#00ff00',
      workspaceId: workspace.id,
      createdById: admin.id,
    });

    expect(result).toBeDefined();
    expect(result.name).toBe('Admin Label');
  });

  it('throws ConflictError for duplicate label name in workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'Bug' });

    await expect(
      LabelMutation.createLabel({
        name: 'Bug',
        color: '#ff0000',
        workspaceId: workspace.id,
        createdById: user.id,
      })
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
      LabelMutation.createLabel({
        name: 'Personal',
        color: '#00ff00',
        createdById: user.id,
      })
    ).rejects.toThrow(ConflictError);
  });

  it('allows same name in different workspaces', async () => {
    const { user: u1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    await createLabel(ws1.id, u1.id, { name: 'Urgent' });

    const result = await LabelMutation.createLabel({
      name: 'Urgent',
      color: '#ff0000',
      workspaceId: ws2.id,
      createdById: u2.id,
    });

    expect(result).toBeDefined();
    expect(result.name).toBe('Urgent');
  });
});

describe('LabelMutation.updateLabel', () => {
  it('updates label name successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { name: 'Old Name' });

    const result = await LabelMutation.updateLabel(label.id, user.id, {
      name: 'New Name',
    });

    expect(result.name).toBe('New Name');
    expect(result.color).toBe(label.color);
  });

  it('updates label color successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { color: '#000000' });

    const result = await LabelMutation.updateLabel(label.id, user.id, {
      color: '#ffffff',
    });

    expect(result.color).toBe('#ffffff');
    expect(result.name).toBe(label.name);
  });

  it('updates label description successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelMutation.updateLabel(label.id, user.id, {
      description: 'New description',
    } as any);

    expect(result.description).toBe('New description');
  });

  it('sets description to null when explicitly passed', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, {
      description: 'Original description',
    } as any);

    const result = await LabelMutation.updateLabel(label.id, user.id, {
      description: null,
    } as any);

    expect(result.description).toBeNull();
  });

  it('throws NotFoundError when label does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelMutation.updateLabel('non-existent-id', user.id, { name: 'Test' })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-creator tries to update personal label', async () => {
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
      LabelMutation.updateLabel(label.id, user2.id, { name: 'Test' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows workspace owner to update any label in workspace', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, member.id, { name: 'Member Label' });

    const result = await LabelMutation.updateLabel(label.id, owner.id, {
      name: 'Owner Renamed',
    });

    expect(result.name).toBe('Owner Renamed');
  });

  it('allows workspace admin to update any label in workspace', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const label = await createLabel(workspace.id, owner.id, { name: 'Owner Label' });

    const result = await LabelMutation.updateLabel(label.id, admin.id, {
      name: 'Admin Renamed',
    });

    expect(result.name).toBe('Admin Renamed');
  });

  it('throws ForbiddenError when member tries to update label they did not create', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id, { name: 'Owner Label' });

    await expect(
      LabelMutation.updateLabel(label.id, member.id, { name: 'Stolen' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ConflictError when renaming to existing name in same workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createLabel(workspace.id, user.id, { name: 'Existing' });
    const label = await createLabel(workspace.id, user.id, { name: 'Target' });

    await expect(
      LabelMutation.updateLabel(label.id, user.id, { name: 'Existing' })
    ).rejects.toThrow(ConflictError);
  });

  it('allows renaming to same name (no-op)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id, { name: 'Same Name' });

    const result = await LabelMutation.updateLabel(label.id, user.id, {
      name: 'Same Name',
    });

    expect(result.name).toBe('Same Name');
  });
});

describe('LabelMutation.deleteLabel', () => {
  it('deletes label successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelMutation.deleteLabel(label.id, user.id);

    expect(result.tasksAffected).toBeDefined();
    expect(typeof result.tasksAffected).toBe('number');

    const deleted = await prisma.label.findUnique({ where: { id: label.id } });
    expect(deleted).toBeNull();
  });

  it('returns correct tasksAffected count', async () => {
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

    const result = await LabelMutation.deleteLabel(label.id, user.id);

    expect(result.tasksAffected).toBe(2);
  });

  it('returns 0 tasksAffected when label has no tasks', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelMutation.deleteLabel(label.id, user.id);

    expect(result.tasksAffected).toBe(0);
  });

  it('throws NotFoundError when label does not exist', async () => {
    const user = await createUser();

    await expect(
      LabelMutation.deleteLabel('non-existent-id', user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-creator tries to delete personal label', async () => {
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
      LabelMutation.deleteLabel(label.id, user2.id)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows workspace owner to delete any label in workspace', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, member.id);

    await LabelMutation.deleteLabel(label.id, owner.id);

    const deleted = await prisma.label.findUnique({ where: { id: label.id } });
    expect(deleted).toBeNull();
  });

  it('throws ForbiddenError when member tries to delete label they did not create', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const label = await createLabel(workspace.id, owner.id);

    await expect(
      LabelMutation.deleteLabel(label.id, member.id)
    ).rejects.toThrow(ForbiddenError);
  });

  it('cascades deletes taskLabel relationships', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id);

    await prisma.taskLabel.create({
      data: { taskId: task.id, labelId: label.id },
    });

    await LabelMutation.deleteLabel(label.id, user.id);

    const taskLabel = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId: task.id, labelId: label.id } },
    });
    expect(taskLabel).toBeNull();

    const taskStillExists = await prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(taskStillExists).not.toBeNull();
  });
});

describe('LabelMutation.addLabelToTask', () => {
  it('adds label to task successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);

    const result = await LabelMutation.addLabelToTask(label.id, task.id, user.id);

    expect(result).toBeDefined();
    expect(result.taskId).toBe(task.id);
    expect(result.labelId).toBe(label.id);

    const db = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId: task.id, labelId: label.id } },
    });
    expect(db).not.toBeNull();
  });

  it('throws NotFoundError when label does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await expect(
      LabelMutation.addLabelToTask('non-existent-label-id', task.id, user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when task does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const label = await createLabel(workspace.id, user.id);

    await expect(
      LabelMutation.addLabelToTask(label.id, 'non-existent-task-id', user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when user has no access to task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);
    const outsider = await createUser();

    await expect(
      LabelMutation.addLabelToTask(label.id, task.id, outsider.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when label already added to task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);

    await prisma.taskLabel.create({
      data: { taskId: task.id, labelId: label.id },
    });

    await expect(
      LabelMutation.addLabelToTask(label.id, task.id, user.id)
    ).rejects.toThrow(ConflictError);
  });
});

describe('LabelMutation.removeLabelFromTask', () => {
  it('removes label from task successfully', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);

    await prisma.taskLabel.create({
      data: { taskId: task.id, labelId: label.id },
    });

    await LabelMutation.removeLabelFromTask(label.id, task.id, user.id);

    const taskLabel = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId: task.id, labelId: label.id } },
    });
    expect(taskLabel).toBeNull();
  });

  it('throws NotFoundError when taskLabel does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);

    await expect(
      LabelMutation.removeLabelFromTask(label.id, task.id, user.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when user has no access to task', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const label = await createLabel(workspace.id, user.id);
    const outsider = await createUser();

    await prisma.taskLabel.create({
      data: { taskId: task.id, labelId: label.id },
    });

    await expect(
      LabelMutation.removeLabelFromTask(label.id, task.id, outsider.id)
    ).rejects.toThrow(NotFoundError);
  });
});
