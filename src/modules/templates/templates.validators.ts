/**
 * modules/templates/templates.validators.ts
 */
import { z } from 'zod';

export const listCatalogQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  tier: z.enum(['FREE', 'PRO', 'BUSINESS']).optional(),
});

export const useTemplateSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  projectName: z.string().trim().min(1).max(80).optional(),
});

export const saveAsTemplateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  visibility: z.enum(['PRIVATE', 'PUBLIC']).optional(),
});

export const updateTemplateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  longDescription: z.string().trim().max(2000).nullable().optional(),
  category: z.string().min(1).max(40).optional(),
  complexity: z.enum(['starter', 'intermediate', 'advanced']).optional(),
  tier: z.enum(['FREE', 'PRO', 'BUSINESS']).optional(),
  status: z.enum(['available', 'coming_soon', 'archived']).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});

export const privateTemplatesQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

export const templateRequestSchema = z.object({
  email: z.string().trim().email('A valid email is required').max(254),
});
