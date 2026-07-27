import { z } from 'zod';

const milestoneStatusEnum = z.enum(['ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED']);
const colorRegex = /^#[0-9A-F]{6}$/i;

export const createMilestoneSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate:     z.coerce.date().optional(),
  color:       z.string().regex(colorRegex).optional(),
  icon:        z.string().optional(),
  projectId:   z.string().min(1),
  dependsOnId: z.string().optional(),
});

export const updateMilestoneSchema = z.object({
  title:        z.string().min(1).max(200).optional(),
  description:  z.string().max(2000).optional(),
  status:       milestoneStatusEnum.optional(),
  progress:     z.number().int().min(0).max(100).optional(),
  color:        z.string().regex(colorRegex).optional(),
  icon:         z.string().optional(),
  dueDate:      z.coerce.date().optional(),
  completed:    z.boolean().optional(),
  dependsOnId:  z.string().nullable().optional(),
});

export type CreateMilestoneBody = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneSchema>;
