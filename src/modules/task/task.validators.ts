import { z } from "zod";

const taskStatusEnum = z.enum([
  "TODO",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "IN_REVIEW",
  "BLOCKED",
  
]);
const taskPriorityEnum = z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]);
const taskIntentEnum = z.enum([
  "EXECUTION",
  "PLANNING",
  "REVIEW",
  "LEARNING",
  "COMMUNICATION",
]);
const energyTypeEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const getTasksQuerySchema = z.object({
  type: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  labelIds: z.string().optional(), // comma-separated, parsed in controller
  assigneeId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z
    .enum(["dueDate", "priority", "status", "createdAt", "title"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const getTaskStatsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  type: z.string().optional(),
});

export const getTasksByIntentQuerySchema = z.object({
  intent: taskIntentEnum,
  workspaceId: z.string().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1, "Task title is required").max(500),
  description: z.string().optional(),
  projectId: z.string().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  dueDate: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  estimatedHours: z.number().min(0).optional(),
  assigneeIds: z
    .array(z.string())
    .max(5, "Too many assignees reduce task focus")
    .optional(),
  labelIds: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  focusRequired: z.boolean().optional(),
  focusLevel: z.number().int().min(1).max(5).optional(),
  energyType: energyTypeEnum.optional(),
  distractionCost: z.number().min(0).optional(),
  intent: taskIntentEnum.optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  estimatedHours: z.number().min(0).optional(),
  assigneeIds: z.array(z.string()).max(5).optional(),
  labelIds: z.array(z.string()).optional(),
  focusRequired: z.boolean().optional(),
  focusLevel: z.number().int().min(1).max(5).optional(),
  energyType: energyTypeEnum.nullable().optional(),
  distractionCost: z.number().min(0).optional(),
  intent: taskIntentEnum.optional(),
});

export const updateTaskStatusSchema = z.object({
  status: taskStatusEnum,
});

export const addCommentSchema = z.object({
  content: z.string().min(1, "Comment content is required").max(5000),
});

export type GetTasksQuery = z.infer<typeof getTasksQuerySchema>;
export type GetTaskStatsQuery = z.infer<typeof getTaskStatsQuerySchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusBody = z.infer<typeof updateTaskStatusSchema>;
export type AddCommentBody = z.infer<typeof addCommentSchema>;
