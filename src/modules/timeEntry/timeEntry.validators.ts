import { z } from 'zod';

// ─── Shared ──────────────────────────────────────────────────────────────────

export const timeEntryCategorySchema = z.enum([
  'DEEP_WORK',
  'MEETINGS',
  'ADMIN',
  'LEARNING',
  'BREAK',
  'OTHER',
]);

// Duration in minutes: at least 1 minute, at most 24 hours.
const durationSchema = z.coerce.number().int().min(1).max(1440);

const startedAtSchema = z
  .string()
  .datetime()
  .optional()
  .transform((v) => (v ? new Date(v) : undefined));

const endedAtSchema = z
  .string()
  .datetime()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null));

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createTimeEntrySchema = z
  .object({
    taskId:      z.string().min(1, 'Task id is required'),
    duration:    durationSchema,
    category:    timeEntryCategorySchema.default('OTHER'),
    billable:    z.boolean().default(false),
    description: z.string().max(500, 'Description must be less than 500 characters').optional().nullable(),
    startedAt:   startedAtSchema,
    endedAt:     endedAtSchema,
  })
  .refine(
    (d) => !(d.startedAt && d.endedAt) || d.endedAt! > d.startedAt!,
    { message: 'endedAt must be after startedAt', path: ['endedAt'] },
  );

export const updateTimeEntrySchema = z
  .object({
    duration:    durationSchema.optional(),
    category:    timeEntryCategorySchema.optional(),
    billable:    z.boolean().optional(),
    description: z.string().max(500, 'Description must be less than 500 characters').optional().nullable(),
    startedAt:   startedAtSchema,
    endedAt:     endedAtSchema,
  })
  .refine(
    (d) => !(d.startedAt && d.endedAt) || d.endedAt! > d.startedAt!,
    { message: 'endedAt must be after startedAt', path: ['endedAt'] },
  );

// ─── Queries ─────────────────────────────────────────────────────────────────

export const myTimeEntriesQuerySchema = z.object({
  from: startedAtSchema,
  to:   startedAtSchema,
  // Optional member filter for the workspace time log. Only meaningful for
  // OWNER/ADMIN — the query layer ignores it for regular members.
  memberUserId: z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CreateTimeEntryBody = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryBody = z.infer<typeof updateTimeEntrySchema>;
export type MyTimeEntriesQuery = z.infer<typeof myTimeEntriesQuerySchema>;
