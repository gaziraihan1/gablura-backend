import { describe, it, expect } from 'vitest';
import { buildTaskScopeWhere } from '../../../utils/taskScope.js';

describe('buildTaskScopeWhere', () => {
  const userId = 'user-123';
  const workspaceId = 'workspace-456';

  it('should build scope for "personal" tasks', () => {
    const where = buildTaskScopeWhere({ userId, type: 'personal' });
    expect(where).toEqual({
      projectId: null,
      createdById: userId,
    });
  });

  it('should build scope for "assigned" tasks', () => {
    const where = buildTaskScopeWhere({ userId, type: 'assigned' });
    expect(where).toEqual({
      assignees: {
        some: { userId },
      },
    });
  });

  it('should build scope for "created" tasks', () => {
    const where = buildTaskScopeWhere({ userId, type: 'created' });
    expect(where).toEqual({
      createdById: userId,
    });
  });

  it('should build scope for "all" (default) tasks', () => {
    const where = buildTaskScopeWhere({ userId });
    expect(where).toEqual({
      OR: [
        { createdById: userId },
        { assignees: { some: { userId } } },
      ],
    });
  });

  it('should add workspaceId to the scope if provided', () => {
    const where = buildTaskScopeWhere({ userId, type: 'personal', workspaceId });
    expect(where).toEqual({
      project: { workspaceId },
      projectId: null,
      createdById: userId,
    });
  });

  it('should add workspaceId to "all" scope if provided', () => {
    const where = buildTaskScopeWhere({ userId, workspaceId });
    expect(where).toEqual({
      OR: [
        { createdById: userId },
        { assignees: { some: { userId } } },
      ],
      project: { workspaceId },
    });
  });
});
