import { describe, it, expect } from 'vitest';
import { 
  createTaskSchema, 
  updateTaskSchema, 
  updateTaskStatusSchema, 
  addCommentSchema, 
  getTasksQuerySchema 
} from '../../../modules/task/task.validators.js';

describe('Task Validators', () => {
  describe('createTaskSchema', () => {
    it('should validate a valid task', () => {
      const validTask = {
        title: 'Valid Task',
        description: 'Description',
        priority: 'HIGH',
        status: 'TODO',
        estimatedHours: 5,
        focusRequired: true,
        focusLevel: 3,
        energyType: 'MEDIUM',
        intent: 'EXECUTION',
      };
      expect(createTaskSchema.parse(validTask)).toEqual(validTask);
    });

    it('should fail if title is missing', () => {
      const invalidTask = { description: 'No title' };
      expect(() => createTaskSchema.parse(invalidTask)).toThrow();
    });

    it('should fail if title is too long', () => {
      const invalidTask = { title: 'a'.repeat(501) };
      expect(() => createTaskSchema.parse(invalidTask)).toThrow();
    });

    it('should fail if focusLevel is out of range', () => {
      const invalidTask = { title: 'Task', focusLevel: 6 };
      expect(() => createTaskSchema.parse(invalidTask)).toThrow();
    });

    it('should fail if too many assignees', () => {
      const invalidTask = { 
        title: 'Task', 
        assigneeIds: ['1', '2', '3', '4', '5', '6'] 
      };
      expect(() => createTaskSchema.parse(invalidTask)).toThrow();
    });

    it('should accept an optional sectionId', () => {
      const task = { title: 'Task', sectionId: 'sec-1' };
      expect(createTaskSchema.parse(task).sectionId).toBe('sec-1');
    });
  });

  describe('updateTaskSchema', () => {
    it('should validate valid updates', () => {
      const validUpdate = {
        title: 'Updated Title',
        status: 'IN_PROGRESS',
        priority: 'LOW',
      };
      expect(updateTaskSchema.parse(validUpdate)).toEqual(validUpdate);
    });

    it('should fail if title is too long', () => {
      const invalidUpdate = { title: 'a'.repeat(501) };
      expect(() => updateTaskSchema.parse(invalidUpdate)).toThrow();
    });
  });

  describe('updateTaskStatusSchema', () => {
    it('should validate valid status', () => {
      expect(updateTaskStatusSchema.parse({ status: 'COMPLETED' })).toEqual({ status: 'COMPLETED' });
    });

    it('should fail for invalid status', () => {
      expect(() => updateTaskStatusSchema.parse({ status: 'INVALID' })).toThrow();
    });
  });

  describe('addCommentSchema', () => {
    it('should validate valid comment', () => {
      expect(addCommentSchema.parse({ content: 'Hello' })).toEqual({ content: 'Hello' });
    });

    it('should fail if content is empty', () => {
      expect(() => addCommentSchema.parse({ content: '' })).toThrow();
    });

    it('should fail if content is too long', () => {
      expect(() => addCommentSchema.parse({ content: 'a'.repeat(5001) })).toThrow();
    });
  });

  describe('getTasksQuerySchema', () => {
    it('should validate valid query params', () => {
      const validQuery = {
        type: 'personal',
        status: 'TODO',
        page: '1',
        pageSize: '20',
        sortBy: 'dueDate',
        sortOrder: 'asc',
      };
      const parsed = getTasksQuerySchema.parse(validQuery);
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(20);
    });

    it('should use default values for pagination', () => {
      const parsed = getTasksQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(10);
    });

    it('should fail if pageSize is too large', () => {
      expect(() => getTasksQuerySchema.parse({ pageSize: '101' })).toThrow();
    });
  });
});
