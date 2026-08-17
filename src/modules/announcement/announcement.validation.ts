import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title:      z.string().min(1, 'Title is required').max(200),
  content:    z.string().min(1, 'Content is required').max(10000),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  isPinned:   z.boolean().optional().default(false),
  targetIds:  z.array(z.string()).optional().default([]),
  projectId:  z.string().optional().nullable(),   // ← new
});

export const updateAnnouncementSchema = z.object({
  title:      z.string().min(1, 'Title is required').max(200).optional(),
  content:    z.string().min(1, 'Content is required').max(10000).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  isPinned:   z.boolean().optional(),
  targetIds:  z.array(z.string()).optional(),
});

export const listAnnouncementsSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  isPinned:   z.coerce.boolean().optional(),
  projectId:  z.string().optional(),   // ← new
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(10),
});

export type CreateAnnouncementBody = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncementSchema>;
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsSchema>;