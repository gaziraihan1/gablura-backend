import { z } from 'zod';

const sectionStatusEnum = z.enum(['PENDING', 'ACTIVE', 'COMPLETED']);
const colorRegex = /^#[0-9A-F]{6}$/i;

export const createSectionSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color:       z.string().regex(colorRegex).optional(),
  status:      sectionStatusEnum.optional(),
  position:    z.number().int().min(0).optional(),
  projectId:   z.string().min(1),
});

export const updateSectionSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color:       z.string().regex(colorRegex).optional(),
  status:      sectionStatusEnum.optional(),
  position:    z.number().int().min(0).optional(),
});

export type CreateSectionBody = z.infer<typeof createSectionSchema>;
export type UpdateSectionBody = z.infer<typeof updateSectionSchema>;
