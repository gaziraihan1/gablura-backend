import { describe, it, expect } from 'vitest';
import {
  createLabelSchema,
  updateLabelSchema,
  labelsQuerySchema,
  popularLabelsQuerySchema,
  labelTasksQuerySchema,
} from '../../../modules/label/label.validators.js';

describe('createLabelSchema', () => {
  it('validates correct create label data', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff0000',
      description: 'Bug reports',
      workspaceId: 'workspace-id',
    });

    expect(result.success).toBe(true);
  });

  it('validates create label data without optional fields', () => {
    const result = createLabelSchema.safeParse({
      name: 'Feature',
      color: '#00ff00',
    });

    expect(result.success).toBe(true);
  });

  it('validates create label data with only required fields', () => {
    const result = createLabelSchema.safeParse({
      name: 'Urgent',
      color: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = createLabelSchema.safeParse({
      color: '#ff0000',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty name', () => {
    const result = createLabelSchema.safeParse({
      name: '',
      color: '#ff0000',
    });

    expect(result.success).toBe(false);
  });

  it('rejects name longer than 50 characters', () => {
    const result = createLabelSchema.safeParse({
      name: 'A'.repeat(51),
      color: '#ff0000',
    });

    expect(result.success).toBe(false);
  });

  it('accepts name exactly 50 characters', () => {
    const result = createLabelSchema.safeParse({
      name: 'A'.repeat(50),
      color: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing color', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid color format (3-char hex)', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#fff',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid color format (plain word)', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: 'red',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid color format (no hash)', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: 'ff0000',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid color format (too long)', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff00000',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid color format (invalid characters)', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#gg0000',
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid 6-digit hex color', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid lowercase hex color', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid uppercase hex color', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#FF0000',
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid mixed case hex color', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#Ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('accepts description when provided', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff0000',
      description: 'This is a description',
    });

    expect(result.success).toBe(true);
  });

  it('accepts workspaceId when provided', () => {
    const result = createLabelSchema.safeParse({
      name: 'Bug',
      color: '#ff0000',
      workspaceId: 'workspace-123',
    });

    expect(result.success).toBe(true);
  });
});

describe('updateLabelSchema', () => {
  it('validates correct update label data with all fields', () => {
    const result = updateLabelSchema.safeParse({
      name: 'Updated Name',
      color: '#00ff00',
      description: 'Updated description',
    });

    expect(result.success).toBe(true);
  });

  it('validates update with only name', () => {
    const result = updateLabelSchema.safeParse({
      name: 'Updated Name',
    });

    expect(result.success).toBe(true);
  });

  it('validates update with only color', () => {
    const result = updateLabelSchema.safeParse({
      color: '#00ff00',
    });

    expect(result.success).toBe(true);
  });

  it('validates update with only description', () => {
    const result = updateLabelSchema.safeParse({
      description: 'New description',
    });

    expect(result.success).toBe(true);
  });

  it('validates empty object (no updates)', () => {
    const result = updateLabelSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('rejects name longer than 50 characters', () => {
    const result = updateLabelSchema.safeParse({
      name: 'A'.repeat(51),
    });

    expect(result.success).toBe(false);
  });

  it('accepts name exactly 50 characters', () => {
    const result = updateLabelSchema.safeParse({
      name: 'A'.repeat(50),
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid color format', () => {
    const result = updateLabelSchema.safeParse({
      color: 'red',
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid color format', () => {
    const result = updateLabelSchema.safeParse({
      color: '#ff0000',
    });

    expect(result.success).toBe(true);
  });

  it('accepts null as description', () => {
    const result = updateLabelSchema.safeParse({
      description: null,
    });

    expect(result.success).toBe(true);
  });

  it('accepts string as description', () => {
    const result = updateLabelSchema.safeParse({
      description: 'Some description',
    });

    expect(result.success).toBe(true);
  });
});

describe('labelsQuerySchema', () => {
  it('validates query with no parameters', () => {
    const result = labelsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('validates query with workspaceId', () => {
    const result = labelsQuerySchema.safeParse({
      workspaceId: 'workspace-123',
    });

    expect(result.success).toBe(true);
  });

  it('validates query with page and limit', () => {
    const result = labelsQuerySchema.safeParse({
      page: 2,
      limit: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
    }
  });

  it('coerces string page to number', () => {
    const result = labelsQuerySchema.safeParse({
      page: '3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
    }
  });

  it('coerces string limit to number', () => {
    const result = labelsQuerySchema.safeParse({
      limit: '15',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(15);
    }
  });

  it('rejects negative page', () => {
    const result = labelsQuerySchema.safeParse({
      page: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects zero page', () => {
    const result = labelsQuerySchema.safeParse({
      page: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit less than 1', () => {
    const result = labelsQuerySchema.safeParse({
      limit: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit greater than 100', () => {
    const result = labelsQuerySchema.safeParse({
      limit: 101,
    });

    expect(result.success).toBe(false);
  });

  it('accepts limit of 100', () => {
    const result = labelsQuerySchema.safeParse({
      limit: 100,
    });

    expect(result.success).toBe(true);
  });

  it('accepts limit of 1', () => {
    const result = labelsQuerySchema.safeParse({
      limit: 1,
    });

    expect(result.success).toBe(true);
  });

  it('uses default page when not provided', () => {
    const result = labelsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
    }
  });

  it('uses default limit when not provided', () => {
    const result = labelsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });
});

describe('popularLabelsQuerySchema', () => {
  it('validates query with no parameters', () => {
    const result = popularLabelsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(10);
    }
  });

  it('validates query with workspaceId', () => {
    const result = popularLabelsQuerySchema.safeParse({
      workspaceId: 'workspace-123',
    });

    expect(result.success).toBe(true);
  });

  it('validates query with page and limit', () => {
    const result = popularLabelsQuerySchema.safeParse({
      page: 2,
      limit: 5,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(5);
    }
  });

  it('uses default limit of 10 when not provided', () => {
    const result = popularLabelsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it('allows custom limit up to 100', () => {
    const result = popularLabelsQuerySchema.safeParse({
      limit: 50,
    });

    expect(result.success).toBe(true);
  });

  it('rejects limit greater than 100', () => {
    const result = popularLabelsQuerySchema.safeParse({
      limit: 101,
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit less than 1', () => {
    const result = popularLabelsQuerySchema.safeParse({
      limit: 0,
    });

    expect(result.success).toBe(false);
  });

  it('coerces string page to number', () => {
    const result = popularLabelsQuerySchema.safeParse({
      page: '3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
    }
  });

  it('coerces string limit to number', () => {
    const result = popularLabelsQuerySchema.safeParse({
      limit: '15',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(15);
    }
  });
});

describe('labelTasksQuerySchema', () => {
  it('validates query with no parameters', () => {
    const result = labelTasksQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('validates query with status', () => {
    const result = labelTasksQuerySchema.safeParse({
      status: 'TODO',
    });

    expect(result.success).toBe(true);
  });

  it('validates query with priority', () => {
    const result = labelTasksQuerySchema.safeParse({
      priority: 'HIGH',
    });

    expect(result.success).toBe(true);
  });

  it('validates query with both status and priority', () => {
    const result = labelTasksQuerySchema.safeParse({
      status: 'IN_PROGRESS',
      priority: 'URGENT',
    });

    expect(result.success).toBe(true);
  });

  it('validates query with page, limit, status, and priority', () => {
    const result = labelTasksQuerySchema.safeParse({
      page: 2,
      limit: 10,
      status: 'COMPLETED',
      priority: 'MEDIUM',
    });

    expect(result.success).toBe(true);
  });

  it('accepts all valid status values', () => {
    const validStatuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED'];

    validStatuses.forEach((status) => {
      const result = labelTasksQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
    });
  });

  it('accepts all valid priority values', () => {
    const validPriorities = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

    validPriorities.forEach((priority) => {
      const result = labelTasksQuerySchema.safeParse({ priority });
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid status value', () => {
    const result = labelTasksQuerySchema.safeParse({
      status: 'INVALID_STATUS',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid priority value', () => {
    const result = labelTasksQuerySchema.safeParse({
      priority: 'INVALID_PRIORITY',
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative page', () => {
    const result = labelTasksQuerySchema.safeParse({
      page: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit less than 1', () => {
    const result = labelTasksQuerySchema.safeParse({
      limit: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects limit greater than 100', () => {
    const result = labelTasksQuerySchema.safeParse({
      limit: 101,
    });

    expect(result.success).toBe(false);
  });

  it('coerces string page to number', () => {
    const result = labelTasksQuerySchema.safeParse({
      page: '3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
    }
  });

  it('coerces string limit to number', () => {
    const result = labelTasksQuerySchema.safeParse({
      limit: '15',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(15);
    }
  });

  it('uses default pagination values when not provided', () => {
    const result = labelTasksQuerySchema.safeParse({
      status: 'TODO',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });
});
