import { z } from 'zod';

const viewTypeEnum = z.enum(['KANBAN', 'LIST', 'CALENDAR', 'TIMELINE']);
const viewVisibilityEnum = z.enum(['PRIVATE', 'SHARED']);

export const createProjectViewSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type:        viewTypeEnum.optional(),
  filters:     z.any().optional(),
  sort:        z.any().optional(),
  config:      z.any().optional(),
  isDefault:   z.boolean().optional(),
  visibility:  viewVisibilityEnum.optional(),
  projectId:   z.string().min(1),
});

export const updateProjectViewSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  type:        viewTypeEnum.optional(),
  filters:     z.any().optional(),
  sort:        z.any().optional(),
  config:      z.any().optional(),
  isDefault:   z.boolean().optional(),
  visibility:  viewVisibilityEnum.optional(),
});

export type CreateProjectViewBody = z.infer<typeof createProjectViewSchema>;
export type UpdateProjectViewBody = z.infer<typeof updateProjectViewSchema>;
