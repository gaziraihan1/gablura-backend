/**
 * src/tests/unit/automation/automation.validators.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  createAutomationSchema,
  updateAutomationSchema,
  listAutomationsQuerySchema,
} from '../../../modules/automation/automation.validators.js';

const baseActions = [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }];

describe('createAutomationSchema', () => {
  it('accepts a valid STATUS_CHANGED rule with trigger config and actions', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Auto-assign on review',
      triggerType: 'STATUS_CHANGED',
      triggerConfig: { fromStatus: 'IN_PROGRESS', toStatus: 'IN_REVIEW' },
      actions: [
        { type: 'ASSIGN_USER', config: { role: 'project-owner' } },
        { type: 'NOTIFY_MEMBERS', config: { message: 'Please review' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a TASK_CREATED rule with a project filter', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Flag new tasks',
      triggerType: 'TASK_CREATED',
      triggerConfig: { projectId: 'proj1' },
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({ projectId: 'proj1' });
  });

  it('defaults triggerConfig to {} when omitted', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Any change',
      triggerType: 'STATUS_CHANGED',
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({});
  });

  it('accepts a DUE_DATE_APPROACHING rule with daysBefore', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Warn about upcoming due dates',
      triggerType: 'DUE_DATE_APPROACHING',
      triggerConfig: { daysBefore: 5 },
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({ daysBefore: 5 });
  });

  it('accepts a DUE_DATE_APPROACHING rule without a config (defaults)', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Default window',
      triggerType: 'DUE_DATE_APPROACHING',
      actions: baseActions,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a DUE_DATE_APPROACHING rule with an out-of-range daysBefore', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad window',
      triggerType: 'DUE_DATE_APPROACHING',
      triggerConfig: { daysBefore: 0 },
      actions: baseActions,
    });
    expect(result.success).toBe(false);

    const tooLarge = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad window',
      triggerType: 'DUE_DATE_APPROACHING',
      triggerConfig: { daysBefore: 999 },
      actions: baseActions,
    });
    expect(tooLarge.success).toBe(false);
  });

  it('rejects a DUE_DATE_APPROACHING rule with an invalid daysBefore type', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad window',
      triggerType: 'DUE_DATE_APPROACHING',
      triggerConfig: { daysBefore: 'three' },
      actions: baseActions,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an ASSIGNEE_CHANGED rule with an optional user filter', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Assignee added',
      triggerType: 'ASSIGNEE_CHANGED',
      triggerConfig: { assigneeUserId: 'user-9' },
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({ assigneeUserId: 'user-9' });

    const noFilter = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Any assignee',
      triggerType: 'ASSIGNEE_CHANGED',
      actions: baseActions,
    });
    expect(noFilter.success).toBe(true);
  });

  it('accepts a LABEL_ADDED rule with an optional label filter', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Label added',
      triggerType: 'LABEL_ADDED',
      triggerConfig: { labelId: 'label-1' },
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({ labelId: 'label-1' });
  });

  it('accepts a MENTION rule with an optional user filter', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Mentioned',
      triggerType: 'MENTION',
      triggerConfig: { mentionedUserId: 'user-3' },
      actions: baseActions,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.triggerConfig).toEqual({ mentionedUserId: 'user-3' });
  });

  it('rejects a missing workspace', () => {
    const result = createAutomationSchema.safeParse({
      name: 'No workspace',
      triggerType: 'STATUS_CHANGED',
      actions: baseActions,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty rule name', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: '   ',
      triggerType: 'STATUS_CHANGED',
      actions: baseActions,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a rule with no actions', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'No actions',
      triggerType: 'STATUS_CHANGED',
      actions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 actions', () => {
    const action = { type: 'SET_PRIORITY', config: { priority: 'HIGH' } };
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Too many actions',
      triggerType: 'STATUS_CHANGED',
      actions: Array.from({ length: 6 }, () => action),
    });
    expect(result.success).toBe(false);
  });

  it('rejects ASSIGN_USER without a target', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Broken assign',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'ASSIGN_USER', config: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects ASSIGN_USER with an invalid email', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad email',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'ASSIGN_USER', config: { email: 'not-an-email' } }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid trigger type', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad trigger',
      triggerType: 'NOT_A_TRIGGER',
      actions: baseActions,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status in the trigger config', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad status',
      triggerType: 'STATUS_CHANGED',
      triggerConfig: { toStatus: 'DOING_STUFF' },
      actions: baseActions,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid priority in SET_PRIORITY', () => {
    const result = createAutomationSchema.safeParse({
      workspaceId: 'ws1',
      name: 'Bad priority',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'SET_PRIORITY', config: { priority: 'MAXIMUM' } }],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateAutomationSchema', () => {
  it('accepts a partial update', () => {
    const result = updateAutomationSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
  });

  it('accepts a full update without workspaceId', () => {
    const result = updateAutomationSchema.safeParse({
      name: 'Renamed',
      triggerType: 'STATUS_CHANGED',
      triggerConfig: { toStatus: 'COMPLETED' },
      actions: baseActions,
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty update', () => {
    const result = updateAutomationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects workspaceId in an update', () => {
    const result = updateAutomationSchema.safeParse({ workspaceId: 'ws2', enabled: true });
    expect(result.success).toBe(false);
  });
});

describe('listAutomationsQuerySchema', () => {
  it('requires workspaceId', () => {
    expect(listAutomationsQuerySchema.safeParse({}).success).toBe(false);
    expect(listAutomationsQuerySchema.safeParse({ workspaceId: 'ws1' }).success).toBe(true);
    expect(
      listAutomationsQuerySchema.safeParse({ workspaceId: 'ws1', projectId: 'proj1' }).success,
    ).toBe(true);
  });
});
