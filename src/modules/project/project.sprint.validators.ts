import { z } from 'zod';

const sprintStatusEnum = z.enum(['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);

export const createSprintSchema = z.object({
  name:      z.string().min(1).max(200),
  goal:      z.string().max(1000).optional(),
  startDate: z.coerce.date(),
  endDate:   z.coerce.date(),
  projectId: z.string().min(1),
});

export const updateSprintSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  goal:            z.string().max(1000).optional(),
  status:          sprintStatusEnum.optional(),
  startDate:       z.coerce.date().optional(),
  endDate:         z.coerce.date().optional(),
  retrospective:  z.string().max(5000).optional(),
  totalPoints:     z.number().int().min(0).optional(),
  completedPoints: z.number().int().min(0).optional(),
  velocity:        z.number().min(0).optional(),
});

export type CreateSprintBody = z.infer<typeof createSprintSchema>;
export type UpdateSprintBody = z.infer<typeof updateSprintSchema>;
