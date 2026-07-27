import { z } from 'zod';

export const createFavoriteSchema = z.object({
  projectId:  z.string().min(1),
  group:      z.string().max(50).optional(),
  sortOrder:  z.number().int().min(0).optional(),
  note:       z.string().max(200).optional(),
});

export const updateFavoriteSchema = z.object({
  group:     z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  note:      z.string().max(200).nullable().optional(),
});

export type CreateFavoriteBody = z.infer<typeof createFavoriteSchema>;
export type UpdateFavoriteBody = z.infer<typeof updateFavoriteSchema>;
