import { describe, it, expect } from 'vitest';
import {
  createSubtaskSchema,
  updateSubtaskSchema,
  updateSubtaskStatusSchema,
} from '../../../../modules/task/subtask/subtask.validators.js';

describe('subtask.validators', () => {
  describe('createSubtaskSchema', () => {
    it('should accept valid minimal input', () => {
      const result = createSubtaskSchema.safeParse({ title: 'Subtask 1' });
      expect(result.success).toBe(true);
    });

    it('should accept with all optional fields', () => {
      const result = createSubtaskSchema.safeParse({
        title: 'Subtask',
        description: 'Details',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        dueDate: '2026-07-20',
        estimatedHours: 5,
        assigneeIds: ['u1', 'u2'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing title', () => {
      const result = createSubtaskSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const result = createSubtaskSchema.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });

    it('should reject title over 500 chars', () => {
      const result = createSubtaskSchema.safeParse({ title: 'x'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('should accept all valid statuses', () => {
      for (const status of ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
        expect(createSubtaskSchema.safeParse({ title: 'Test', status }).success).toBe(true);
      }
    });

    it('should reject invalid status', () => {
      const result = createSubtaskSchema.safeParse({ title: 'Test', status: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should accept all valid priorities', () => {
      for (const priority of ['URGENT', 'HIGH', 'MEDIUM', 'LOW']) {
        expect(createSubtaskSchema.safeParse({ title: 'Test', priority }).success).toBe(true);
      }
    });

    it('should reject invalid priority', () => {
      const result = createSubtaskSchema.safeParse({ title: 'Test', priority: 'CRITICAL' });
      expect(result.success).toBe(false);
    });

    it('should reject estimatedHours below 0', () => {
      const result = createSubtaskSchema.safeParse({ title: 'Test', estimatedHours: -1 });
      expect(result.success).toBe(false);
    });

    it('should accept estimatedHours of 0', () => {
      const result = createSubtaskSchema.safeParse({ title: 'Test', estimatedHours: 0 });
      expect(result.success).toBe(true);
    });

    it('should reject more than 5 assignees', () => {
      const result = createSubtaskSchema.safeParse({
        title: 'Test',
        assigneeIds: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateSubtaskSchema', () => {
    it('should accept empty object', () => {
      const result = updateSubtaskSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial updates', () => {
      const result = updateSubtaskSchema.safeParse({ title: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('should accept null dueDate', () => {
      const result = updateSubtaskSchema.safeParse({ dueDate: null });
      expect(result.success).toBe(true);
    });
  });

  describe('updateSubtaskStatusSchema', () => {
    it('should accept valid status', () => {
      const result = updateSubtaskStatusSchema.safeParse({ status: 'COMPLETED' });
      expect(result.success).toBe(true);
    });

    it('should reject missing status', () => {
      const result = updateSubtaskStatusSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const result = updateSubtaskStatusSchema.safeParse({ status: 'INVALID' });
      expect(result.success).toBe(false);
    });
  });
});
