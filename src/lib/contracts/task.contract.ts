/**
 * src/lib/contracts/task.contract.ts
 *
 * CANONICAL WIRE CONTRACTS for task API payloads.
 *
 * Single source of truth shared between backend contract tests and the
 * frontend (synced via `npm run sync:contracts`). Change the endpoint's output
 * HERE first.
 *
 * Nullable-relation notes:
 *  - `project` is nullable: Task.projectId is optional in the schema.
 *  - `project.workspace` is nullable: Project's relation is a compound FK on
 *    (workspaceId, workspaceSlug); legacy/dangling rows resolve it to null.
 *    Frontend MUST NOT read `task.project.workspace.name` unguarded.
 *
 * Compatible with Zod v3 (frontend) and v4 (backend).
 */
import { z } from "zod";

// ─── Shared fragments ──────────────────────────────────────────────────────────

export const taskUserSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .passthrough();

/** TaskAssignee row + included user select. */
export const taskAssigneeSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    userId: z.string(),
    assignedAt: z.string(), // ISO datetime
    user: taskUserSchema,
  })
  .passthrough();

export const labelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    description: z.string().nullable(),
  })
  .passthrough();

/** TaskLabel join row with the nested label. */
export const taskLabelSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    labelId: z.string(),
    label: labelSchema,
  })
  .passthrough();

/**
 * Project as embedded in task payloads. Both the project itself and its
 * workspace summary are nullable — see header note.
 */
export const taskProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  status: z.string(),
  workspaceId: z.string().nullable(),
  workspace: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
    })
    .nullable(),
});

export const sprintSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const milestoneSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  progress: z.number(),
});

/** Computed server-side by getTimeStatus() and appended to list/detail items. */
export const timeTrackingSchema = z.object({
  hoursSinceCreation: z.number(),
  hoursUntilDue: z.number().nullable(),
  isOverdue: z.boolean(),
  isDueToday: z.boolean(),
  timeProgress: z.number().nullable(),
});

// ─── GET /api/v1/tasks (list; also backs the team-task page) ───────────────────

export const taskListItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
    startDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    completedAt: z.string().nullable(),
    estimatedHours: z.number().nullable(),
    actualHours: z.number().nullable(),
    focusRequired: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    projectId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    sprintId: z.string().nullable(),
    sectionId: z.string().nullable(),
    milestoneId: z.string().nullable(),
    createdById: z.string(),
    createdBy: taskUserSchema,
    editedBy: taskUserSchema.nullable(),
    assignees: z.array(taskAssigneeSchema),
    labels: z.array(taskLabelSchema),
    project: taskProjectSchema.nullable(),
    sprint: sprintSummarySchema.nullable(),
    milestone: milestoneSummarySchema.nullable(),
    recurrence: z.record(z.string(), z.unknown()).nullable(),
    _count: z.object({
      comments: z.number(),
      subtasks: z.number(),
      files: z.number(),
    }),
    timeTracking: timeTrackingSchema,
  })
  .passthrough();

export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const paginationMetaSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number(),
  totalPages: z.number(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export const taskListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(taskListItemSchema),
  pagination: paginationMetaSchema,
});

// ─── GET /api/v1/tasks/stats (task stats envelope) ─────────────────────────────

export const taskStatsSchema = z.object({
  personal: z.number(),
  assigned: z.number(),
  created: z.number(),
  overdue: z.number(),
  dueToday: z.number(),
  totalTasks: z.number(),
  inProgress: z.number(),
  completed: z.number(),
  byStatus: z.record(z.string(), z.number()),
});

export type TaskStatsWire = z.infer<typeof taskStatsSchema>;
