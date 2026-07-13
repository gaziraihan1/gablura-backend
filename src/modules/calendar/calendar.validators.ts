import { z } from 'zod';

export const calendarRangeSchema = z.object({
  workspaceId: z.string().optional(),
  startDate:   z.coerce.date(),
  endDate:     z.coerce.date(),
});

export const createGoalCheckpointSchema = z.object({
  workspaceId: z.string().optional(),
  title:       z.string().min(1, 'Title is required'),
  type:        z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'KPI']),
  targetDate:  z.coerce.date(),
});

export const recalculateSchema = z.object({
  workspaceId: z.string().optional(),
  date:        z.coerce.date(),
});

export const updateCapacitySchema = z.object({
  weeklyHours:        z.number().int().min(1).max(168).optional(),
  dailyCapacityHours: z.number().int().min(1).max(24).optional(),
  deepWorkHours:      z.number().int().min(0).max(24).optional(),
}).refine(data => data.weeklyHours !== undefined || data.dailyCapacityHours !== undefined || data.deepWorkHours !== undefined, {
  message: 'At least one field (weeklyHours, dailyCapacityHours, deepWorkHours) must be provided',
});

export const updateScheduleSchema = z.object({
  workDays:      z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour:   z.number().int().min(0).max(23).optional(),
  timezone:      z.string().optional(),
}).refine(data => data.workDays !== undefined || data.workStartHour !== undefined || data.workEndHour !== undefined || data.timezone !== undefined, {
  message: 'At least one field (workDays, workStartHour, workEndHour, timezone) must be provided',
});

export const logEnergySchema = z.object({
  date:        z.coerce.date(),
  energyLevel: z.number().int().min(1).max(10),
  note:        z.string().max(500).optional(),
});

export const energyHistorySchema = z.object({
  startDate: z.coerce.date(),
  endDate:   z.coerce.date(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(31),
});

export type CalendarRangeInput         = z.infer<typeof calendarRangeSchema>;
export type CreateGoalCheckpointInput  = z.infer<typeof createGoalCheckpointSchema>;
export type RecalculateInput           = z.infer<typeof recalculateSchema>;
export type UpdateCapacityInput        = z.infer<typeof updateCapacitySchema>;
export type UpdateScheduleInput        = z.infer<typeof updateScheduleSchema>;
export type LogEnergyInput             = z.infer<typeof logEnergySchema>;
export type EnergyHistoryInput         = z.infer<typeof energyHistorySchema>;