import { z } from 'zod';

export const createRatingSchema = z.object({
  stars: z
    .number()
    .int()
    .min(1, 'Rating must be at least 1 star')
    .max(5, 'Rating must be at most 5 stars'),
  comment: z
    .string()
    .trim()
    .max(2000, 'Comment must be under 2000 characters')
    .optional()
    .nullable(),
});

export const updateRatingSchema = z.object({
  stars: z
    .number()
    .int()
    .min(1, 'Rating must be at least 1 star')
    .max(5, 'Rating must be at most 5 stars')
    .optional(),
  comment: z
    .string()
    .trim()
    .max(2000, 'Comment must be under 2000 characters')
    .optional()
    .nullable(),
});

export type CreateRatingBody = z.infer<typeof createRatingSchema>;
export type UpdateRatingBody = z.infer<typeof updateRatingSchema>;
