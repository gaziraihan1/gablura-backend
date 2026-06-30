import { describe, it, expect, vi } from 'vitest';
import { getTimeStatus, getTimeStatusBatch } from '../../../modules/task/task.utils.js';
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
