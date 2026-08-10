import { z } from "zod";
import type { AiCommentTone, AiEnergyType, AiIntent, AiPriority } from "./ai.types.js";

/**
 * Zod schemas for the AI module.
 *
 * Two families:
 * - `*InputSchema`  — validate what the client sends us.
 * - `*OutputSchema` — validate what the LLM returns. LLM output is untrusted
 *   input: malformed JSON or type mismatches become `AI_INVALID_RESPONSE`
 *   (502) instead of ever reaching the client unvalidated.
 */

const energyTypeEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
const priorityEnum = z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]);
const intentEnum = z.enum([
  "EXECUTION",
  "PLANNING",
  "REVIEW",
  "LEARNING",
  "COMMUNICATION",
]);

export const aiToneEnum = z.enum([
  "professional",
  "friendly",
  "concise",
  "formal",
  "persuasive",
]);

/** Optional — when omitted the request is scoped to the user (personal tasks). */
const workspaceIdField = z
  .string()
  .trim()
  .min(1, "workspaceId must not be empty")
  .max(100)
  .optional();

// ─── Input schemas ────────────────────────────────────────────────────────────

export const autocompleteInputSchema = z.object({
  workspaceId: workspaceIdField,
  title: z
    .string()
    .trim()
    .min(3, "Task title must be at least 3 characters")
    .max(200, "Task title is too long"),
  projectId: z.string().trim().min(1).max(100).optional(),
  energyType: energyTypeEnum.optional(),
});

export const breakdownInputSchema = z.object({
  workspaceId: workspaceIdField,
  goal: z
    .string()
    .trim()
    .min(5, "Describe your goal with at least 5 characters")
    .max(500, "Goal is too long"),
  energyType: energyTypeEnum.optional(),
});

export const commentAssistInputSchema = z.object({
  workspaceId: workspaceIdField,
  text: z
    .string()
    .trim()
    .min(2, "Add a little more text to rewrite")
    .max(2000, "Text is too long"),
  tone: aiToneEnum.default("professional"),
});

export const dailyPlanInputSchema = z.object({
  workspaceId: workspaceIdField,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  tasks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        title: z.string().trim().min(1).max(200),
        priority: priorityEnum.optional().nullable(),
        energyType: energyTypeEnum.optional().nullable(),
        estimatedHours: z.number().min(0).max(1000).optional().nullable(),
        dueDate: z.string().max(50).optional().nullable(),
      }),
    )
    .min(1, "Provide at least one task to schedule")
    .max(50, "Too many tasks — keep the day plan under 50 tasks"),
});

export const meetingSummaryInputSchema = z.object({
  workspaceId: workspaceIdField,
  meetingId: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(10_000).optional(),
});

export const weeklyInsightsInputSchema = z.object({
  // Insights are workspace-scoped — required here (unlike personal features).
  workspaceId: z
    .string()
    .trim()
    .min(1, "workspaceId is required for weekly insights")
    .max(100),
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "week must be YYYY-MM-DD")
    .optional(),
});

export const quotaQuerySchema = z.object({
  workspaceId: workspaceIdField,
});

export const usageQuerySchema = z.object({
  // Usage reports are workspace-scoped and OWNER/ADMIN-gated (access.ts).
  workspaceId: z
    .string()
    .trim()
    .min(1, "workspaceId is required for AI usage reports")
    .max(100),
  days: z
    .coerce
    .number()
    .int()
    .min(1, "days must be at least 1")
    .max(90, "days must be at most 90")
    .optional(),
});

// ─── LLM output schemas (strict-ish; unknown keys are stripped) ──────────────

const subtaskOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const autocompleteOutputSchema = z.object({
  description: z.string().max(2000),
  priority: priorityEnum.optional().nullable(),
  estimatedHours: z.number().min(0).max(1000).optional().nullable(),
  dueDate: z.string().max(50).optional().nullable(),
  energyType: energyTypeEnum.optional().nullable(),
  intent: intentEnum.optional().nullable(),
  subtasks: z.array(subtaskOutputSchema).max(20).optional(),
});

export const breakdownOutputSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        energyType: energyTypeEnum.optional().nullable(),
        estimatedHours: z.number().min(0).max(1000).optional().nullable(),
      }),
    )
    .min(1, "The AI must return at least one task")
    .max(20),
  rationale: z.string().max(2000).optional(),
});

export const commentAssistOutputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export const dailyPlanOutputSchema = z.object({
  plan: z
    .array(
      z.object({
        taskId: z.string().trim().min(1).max(100),
        order: z.number().int().min(1).max(50),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .min(1, "The AI must return at least one scheduled task")
    .max(50),
  rationale: z.string().max(2000).optional(),
});

export const meetingSummaryOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  actionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        assigneeEmail: z.string().email().optional().nullable(),
      }),
    )
    .max(20)
    .optional(),
});

export const weeklyInsightsOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  highlights: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string().max(500).optional(),
      }),
    )
    .max(10)
    .optional(),
  risks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string().max(500).optional(),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
      }),
    )
    .max(10)
    .optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type AutocompleteInput = z.infer<typeof autocompleteInputSchema>;
export type BreakdownInput = z.infer<typeof breakdownInputSchema>;
export type CommentAssistInput = z.infer<typeof commentAssistInputSchema>;
export type QuotaQuery = z.infer<typeof quotaQuerySchema>;
export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type AutocompleteOutput = z.infer<typeof autocompleteOutputSchema>;
export type BreakdownOutput = z.infer<typeof breakdownOutputSchema>;
export type CommentAssistOutput = z.infer<typeof commentAssistOutputSchema>;
export type DailyPlanInput = z.infer<typeof dailyPlanInputSchema>;
export type DailyPlanOutput = z.infer<typeof dailyPlanOutputSchema>;
export type MeetingSummaryInput = z.infer<typeof meetingSummaryInputSchema>;
export type MeetingSummaryOutput = z.infer<typeof meetingSummaryOutputSchema>;
export type WeeklyInsightsInput = z.infer<typeof weeklyInsightsInputSchema>;
export type WeeklyInsightsOutput = z.infer<typeof weeklyInsightsOutputSchema>;

// Re-export enums so consumers (prompts, tests) share one definition.
export type { AiEnergyType, AiIntent, AiPriority, AiCommentTone };
