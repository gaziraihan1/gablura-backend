/**
 * modules/automation/automation.validators.ts
 *
 * Zod validation for automation rule CRUD. Rules are validated here and the
 * worker re-validates nothing — the stored JSON is trusted only after passing
 * these schemas.
 */
import { z } from 'zod';

const taskStatusEnum = z.enum([
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
]);

const taskPriorityEnum = z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);

// ─── Trigger configs ──────────────────────────────────────────────────────────
// Both schemas are strict so the union resolves to exactly one shape: a
// STATUS_CHANGED config may only carry fromStatus/toStatus, a TASK_CREATED
// config only projectId. Unknown keys fail validation instead of being
// silently stripped.

const statusChangedTriggerSchema = z
  .object({
    fromStatus: taskStatusEnum.nullable().optional(),
    toStatus: taskStatusEnum.nullable().optional(),
  })
  .strict();

const taskCreatedTriggerSchema = z
  .object({
    projectId: z.string().nullable().optional(),
  })
  .strict();

const dueDateApproachingTriggerSchema = z
  .object({
    daysBefore: z.number().int().min(1).max(90).nullable().optional(),
  })
  .strict();

const assigneeChangedTriggerSchema = z
  .object({
    assigneeUserId: z.string().nullable().optional(),
  })
  .strict();

const labelAddedTriggerSchema = z
  .object({
    labelId: z.string().nullable().optional(),
  })
  .strict();

const mentionTriggerSchema = z
  .object({
    mentionedUserId: z.string().nullable().optional(),
  })
  .strict();

const triggerConfigSchema = z.union([
  statusChangedTriggerSchema,
  taskCreatedTriggerSchema,
  dueDateApproachingTriggerSchema,
  assigneeChangedTriggerSchema,
  labelAddedTriggerSchema,
  mentionTriggerSchema,
]);

// ─── Actions ──────────────────────────────────────────────────────────────────

const assignUserConfigSchema = z
  .object({
    assigneeUserId: z.string().nullable().optional(),
    email: z.string().email('A valid email is required').nullable().optional(),
    role: z.enum(['project-owner', 'actor']).nullable().optional(),
  })
  .superRefine((config, ctx) => {
    if (!config.assigneeUserId && !config.email && !config.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ASSIGN_USER requires assigneeUserId, email, or role',
      });
    }
  });

const setPriorityConfigSchema = z.object({
  priority: taskPriorityEnum,
});

const notifyMembersConfigSchema = z.object({
  message: z.string().max(500).nullable().optional(),
});

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ASSIGN_USER'), config: assignUserConfigSchema }),
  z.object({ type: z.literal('SET_PRIORITY'), config: setPriorityConfigSchema }),
  z.object({ type: z.literal('NOTIFY_MEMBERS'), config: notifyMembersConfigSchema }),
]);

const actionsSchema = z
  .array(actionSchema)
  .min(1, 'At least one action is required')
  .max(5, 'A rule can have at most 5 actions');

// ─── Rule schemas ─────────────────────────────────────────────────────────────

export const listAutomationsQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace is required'),
  projectId: z.string().optional(),
});

export const createAutomationSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace is required'),
  projectId: z.string().nullable().optional(),
  name: z.string().trim().min(1, 'Rule name is required').max(100),
  triggerType: z.enum([
    'STATUS_CHANGED',
    'TASK_CREATED',
    'DUE_DATE_APPROACHING',
    'ASSIGNEE_CHANGED',
    'LABEL_ADDED',
    'MENTION',
  ]),
  triggerConfig: triggerConfigSchema.optional().default({}),
  actions: actionsSchema,
});

export const testAutomationSchema = z.object({
  taskId: z.string().min(1, 'A task is required to run the rule against'),
});

export const updateAutomationSchema = z
  .object({
    projectId: z.string().nullable().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    triggerType: z
      .enum([
        'STATUS_CHANGED',
        'TASK_CREATED',
        'DUE_DATE_APPROACHING',
        'ASSIGNEE_CHANGED',
        'LABEL_ADDED',
        'MENTION',
      ])
      .optional(),
    triggerConfig: triggerConfigSchema.optional(),
    actions: actionsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'No updates provided',
  });
