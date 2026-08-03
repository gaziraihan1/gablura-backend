import { describe, it, expect, vi } from 'vitest';
import { getTimeStatus, getTimeStatusBatch, computeTaskChanges } from '../../../modules/task/task.utils.js';
import { isTaskOverdue } from '../../../modules/task/task.query.js';
import type { TaskForTimeTracking } from '../../../modules/task/task.types.js';

describe('Task Utils - getTimeStatus', () => {
  const mockNow = new Date('2026-06-28T12:00:00Z');
  
  const baseTask: TaskForTimeTracking = {
    id: 'task-1',
    title: 'Test Task',
    status: 'TODO',
    createdAt: new Date('2026-06-27T12:00:00Z'), // 24 hours ago
    dueDate: new Date('2026-06-29T12:00:00Z'), // 24 hours from now
    estimatedHours: 10,
    actualHours: 0,
  };

  it('should calculate hoursSinceCreation correctly', () => {
    const status = getTimeStatus(baseTask, mockNow);
    expect(status.hoursSinceCreation).toBe(24);
  });

  it('should calculate hoursUntilDue correctly', () => {
    const status = getTimeStatus(baseTask, mockNow);
    expect(status.hoursUntilDue).toBe(24);
  });

  it('should identify if a task is due today', () => {
    const todayDueTask = {
      ...baseTask,
      dueDate: new Date(mockNow), // Set to exactly mockNow
    };
    const status = getTimeStatus(todayDueTask, mockNow);
    expect(status.isDueToday).toBe(true);
  });

  it('should identify if a task is NOT due today', () => {
    const status = getTimeStatus(baseTask, mockNow);
    expect(status.isDueToday).toBe(false);
  });

  it('should mark as overdue if actualHours > estimatedHours', () => {
    const overdueTask = {
      ...baseTask,
      actualHours: 15,
      estimatedHours: 10,
    };
    const status = getTimeStatus(overdueTask, mockNow);
    expect(status.isOverdue).toBe(true);
  });

  it('should mark as overdue if hoursSinceCreation > estimatedHours (no actualHours)', () => {
    const overdueTask = {
      ...baseTask,
      actualHours: null,
      estimatedHours: 5, // Created 24h ago, estimated 5h
    };
    const status = getTimeStatus(overdueTask, mockNow);
    expect(status.isOverdue).toBe(true);
  });

  it('should mark as overdue if now > dueDate (no estimatedHours)', () => {
    const overdueTask = {
      ...baseTask,
      estimatedHours: null,
      actualHours: null,
      dueDate: new Date('2026-06-27T12:00:00Z'), // Due yesterday
    };
    const status = getTimeStatus(overdueTask, mockNow);
    expect(status.isOverdue).toBe(true);
  });

  it('should NOT mark as overdue if status is COMPLETED or CANCELLED', () => {
    const completedTask = {
      ...baseTask,
      status: 'COMPLETED' as any,
      actualHours: 15,
      estimatedHours: 10,
    };
    const status = getTimeStatus(completedTask, mockNow);
    expect(status.isOverdue).toBe(false);

    const cancelledTask = {
      ...baseTask,
      status: 'CANCELLED' as any,
      actualHours: 15,
      estimatedHours: 10,
    };
    const statusCancelled = getTimeStatus(cancelledTask, mockNow);
    expect(statusCancelled.isOverdue).toBe(false);
  });

  it('should calculate timeProgress correctly', () => {
    const task = {
      ...baseTask,
      estimatedHours: 48, // Created 24h ago, 48h total
    };
    const status = getTimeStatus(task, mockNow);
    expect(status.timeProgress).toBe(50);
  });

  it('should cap timeProgress at 100', () => {
    const task = {
      ...baseTask,
      estimatedHours: 12, // Created 24h ago, 12h total
    };
    const status = getTimeStatus(task, mockNow);
    expect(status.timeProgress).toBe(100);
  });

  it('should return null for timeProgress if estimatedHours is missing', () => {
    const task = {
      ...baseTask,
      estimatedHours: null,
    };
    const status = getTimeStatus(task, mockNow);
    expect(status.timeProgress).toBeNull();
  });

  it('should return null for hoursUntilDue if dueDate is missing', () => {
    const task = {
      ...baseTask,
      dueDate: null,
    };
    const status = getTimeStatus(task, mockNow);
    expect(status.hoursUntilDue).toBeNull();
  });
});

describe('Task Utils - getTimeStatusBatch', () => {
  it('should process multiple tasks', () => {
    const tasks: TaskForTimeTracking[] = [
      {
        id: '1',
        title: 'T1',
        status: 'TODO',
        createdAt: new Date(),
        dueDate: null,
        estimatedHours: 1,
        actualHours: 0,
      },
      {
        id: '2',
        title: 'T2',
        status: 'TODO',
        createdAt: new Date(),
        dueDate: null,
        estimatedHours: 2,
        actualHours: 0,
      },
    ];

    const results = getTimeStatusBatch(tasks);
    expect(results.size).toBe(2);
    expect(results.has('1')).toBe(true);
    expect(results.has('2')).toBe(true);
  });
});

describe('isTaskOverdue', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  describe('actualHours > estimatedHours', () => {
    it('should return true when actual exceeds estimated', () => {
      const task = {
        estimatedHours: 5,
        actualHours: 8,
        dueDate: null,
        createdAt: new Date('2026-07-14T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(true);
    });

    it('should return false when actual is within estimated', () => {
      const task = {
        estimatedHours: 10,
        actualHours: 5,
        dueDate: null,
        createdAt: new Date('2026-07-14T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });

    it('should return false when actual equals estimated', () => {
      const task = {
        estimatedHours: 8,
        actualHours: 8,
        dueDate: null,
        createdAt: new Date('2026-07-14T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });
  });

  describe('estimatedHours set, actualHours null (elapsed time)', () => {
    it('should return true when elapsed hours exceed estimated', () => {
      const task = {
        estimatedHours: 4,
        actualHours: null,
        dueDate: null,
        createdAt: new Date('2026-07-15T00:00:00Z'), // 12 hours ago
      };
      expect(isTaskOverdue(task, now)).toBe(true);
    });

    it('should return false when elapsed hours are within estimated', () => {
      const task = {
        estimatedHours: 24,
        actualHours: null,
        dueDate: null,
        createdAt: new Date('2026-07-15T00:00:00Z'), // 12 hours ago
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });

    it('should return false when elapsed exactly equals estimated', () => {
      const task = {
        estimatedHours: 12,
        actualHours: null,
        dueDate: null,
        createdAt: new Date('2026-07-15T00:00:00Z'), // exactly 12 hours ago
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });
  });

  describe('no estimatedHours, dueDate set', () => {
    it('should return true when dueDate is in the past', () => {
      const task = {
        estimatedHours: null,
        actualHours: null,
        dueDate: new Date('2026-07-14T12:00:00Z'), // yesterday
        createdAt: new Date('2026-07-10T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(true);
    });

    it('should return false when dueDate is in the future', () => {
      const task = {
        estimatedHours: null,
        actualHours: null,
        dueDate: new Date('2026-07-16T12:00:00Z'), // tomorrow
        createdAt: new Date('2026-07-10T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });

    it('should return false when dueDate equals now', () => {
      const task = {
        estimatedHours: null,
        actualHours: null,
        dueDate: new Date('2026-07-15T12:00:00Z'), // exactly now
        createdAt: new Date('2026-07-10T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });
  });

  describe('no estimatedHours, no dueDate', () => {
    it('should return false when both are null', () => {
      const task = {
        estimatedHours: null,
        actualHours: null,
        dueDate: null,
        createdAt: new Date('2026-07-10T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should prefer actualHours check over elapsed time when both estimatedHours and actualHours are set', () => {
      // estimatedHours=5, actualHours=3 (not over), but created 48h ago (would be over)
      // The first branch wins: actualHours < estimatedHours, so NOT overdue
      const task = {
        estimatedHours: 5,
        actualHours: 3,
        dueDate: new Date('2026-07-10T00:00:00Z'), // past due
        createdAt: new Date('2026-07-13T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(false);
    });

    it('should return true when actualHours is set and exceeds, even with dueDate in future', () => {
      const task = {
        estimatedHours: 2,
        actualHours: 10,
        dueDate: new Date('2026-07-20T12:00:00Z'), // future
        createdAt: new Date('2026-07-14T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(true);
    });

    it('should handle zero estimatedHours with actualHours set', () => {
      const task = {
        estimatedHours: 0,
        actualHours: 1,
        dueDate: null,
        createdAt: new Date('2026-07-15T00:00:00Z'),
      };
      expect(isTaskOverdue(task, now)).toBe(true);
    });

    it('should handle zero estimatedHours with null actualHours', () => {
      const task = {
        estimatedHours: 0,
        actualHours: null,
        dueDate: null,
        createdAt: new Date('2026-07-14T00:00:00Z'),
      };
      // elapsed = 36h > 0, so overdue
      expect(isTaskOverdue(task, now)).toBe(true);
    });
  });
});

describe('Task Utils - computeTaskChanges', () => {
  const baseSnapshot = {
    title: 'Old title',
    description: 'Old desc',
    priority: 'MEDIUM',
    status: 'TODO',
    projectId: 'p1',
    dueDate: new Date('2026-01-01T00:00:00.000Z'),
    startDate: null,
    estimatedHours: 4,
    focusRequired: false,
    focusLevel: null,
    energyType: 'LOW',
    distractionCost: null,
    intent: 'EXECUTION',
    assignees: [{ userId: 'u1' }],
    labels: [{ labelId: 'l1' }],
  };

  it('returns an empty object when nothing changed', () => {
    expect(computeTaskChanges({ title: 'Old title', priority: 'MEDIUM' }, baseSnapshot)).toEqual({});
  });

  it('detects scalar field changes', () => {
    expect(
      computeTaskChanges({ title: 'New title', description: 'New desc', priority: 'HIGH' }, baseSnapshot),
    ).toEqual({ title: 'New title', description: 'New desc', priority: 'HIGH' });
  });

  it('detects when an optional date is cleared to null', () => {
    expect(computeTaskChanges({ dueDate: null }, baseSnapshot)).toEqual({ dueDate: null });
  });

  it('treats an equal date as unchanged', () => {
    expect(
      computeTaskChanges({ dueDate: new Date('2026-01-01T00:00:00.000Z') }, baseSnapshot),
    ).toEqual({});
  });

  it('detects assignee and label changes', () => {
    expect(computeTaskChanges({ assigneeIds: ['u2'], labelIds: ['l2'] }, baseSnapshot)).toEqual({
      assignees: 'assignees (1)',
      labels:    'labels (1)',
    });
  });

  it('ignores assignees/labels that did not change', () => {
    expect(computeTaskChanges({ assigneeIds: ['u1'], labelIds: ['l1'] }, baseSnapshot)).toEqual({});
  });

  it('returns an empty object when the old snapshot is unavailable', () => {
    expect(computeTaskChanges({ title: 'Anything' }, null)).toEqual({});
  });

  it('truncates long description values', () => {
    const changes = computeTaskChanges({ description: 'x'.repeat(500) }, baseSnapshot);
    expect(changes.description as string).toHaveLength(201); // 200 chars + ellipsis
  });
});
