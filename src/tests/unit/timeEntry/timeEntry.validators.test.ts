import { describe, it, expect } from 'vitest';
import {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  myTimeEntriesQuerySchema,
} from '../../../modules/timeEntry/timeEntry.validators.js';

describe('createTimeEntrySchema', () => {
  it('accepts a valid minimal entry', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 'task-1',
      duration: 30,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('OTHER');
      expect(result.data.billable).toBe(false);
    }
  });

  it('accepts a full entry with all fields', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 'task-1',
      duration: 90,
      category: 'DEEP_WORK',
      billable: true,
      description: 'Focused implementation',
      startedAt: '2026-08-01T09:00:00.000Z',
      endedAt: '2026-08-01T10:30:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing taskId', () => {
    const result = createTimeEntrySchema.safeParse({ duration: 30 });
    expect(result.success).toBe(false);
  });

  it('rejects zero and negative durations', () => {
    expect(createTimeEntrySchema.safeParse({ taskId: 't', duration: 0 }).success).toBe(false);
    expect(createTimeEntrySchema.safeParse({ taskId: 't', duration: -5 }).success).toBe(false);
  });

  it('rejects durations over 24 hours', () => {
    expect(createTimeEntrySchema.safeParse({ taskId: 't', duration: 1441 }).success).toBe(false);
    expect(createTimeEntrySchema.safeParse({ taskId: 't', duration: 1440 }).success).toBe(true);
  });

  it('rejects an invalid category', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 't',
      duration: 30,
      category: 'SLEEPING',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endedAt before startedAt', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 't',
      duration: 30,
      startedAt: '2026-08-01T10:30:00.000Z',
      endedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts nullable description', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 't',
      duration: 30,
      description: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a description over 500 characters', () => {
    const result = createTimeEntrySchema.safeParse({
      taskId: 't',
      duration: 30,
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('updateTimeEntrySchema', () => {
  it('accepts partial updates', () => {
    expect(updateTimeEntrySchema.safeParse({ duration: 45 }).success).toBe(true);
    expect(updateTimeEntrySchema.safeParse({ category: 'MEETINGS' }).success).toBe(true);
    expect(updateTimeEntrySchema.safeParse({ billable: true }).success).toBe(true);
    expect(updateTimeEntrySchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid duration', () => {
    expect(updateTimeEntrySchema.safeParse({ duration: 0 }).success).toBe(false);
  });
});

describe('myTimeEntriesQuerySchema', () => {
  it('accepts empty query', () => {
    expect(myTimeEntriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts a date range', () => {
    const result = myTimeEntriesQuerySchema.safeParse({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-07T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBeInstanceOf(Date);
      expect(result.data.to).toBeInstanceOf(Date);
    }
  });

  it('rejects invalid dates', () => {
    expect(myTimeEntriesQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });
});
