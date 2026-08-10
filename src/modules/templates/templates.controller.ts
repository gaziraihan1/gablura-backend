/**
 * modules/templates/templates.controller.ts
 */
import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import { prisma } from '../../lib/prisma.js';
import { TemplateQuery } from './templates.query.js';
import { TemplateMutation } from './templates.mutation.js';
import {
  listCatalogQuerySchema,
  useTemplateSchema,
  saveAsTemplateSchema,
  updateTemplateSchema,
  privateTemplatesQuerySchema,
  templateRequestSchema,
  rateTemplateSchema,
} from './templates.validators.js';

/** Admin: list community templates waiting for approval. */
export const listPendingTemplates = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await TemplateQuery.getPendingForModeration();
  res.json({ success: true, data });
});

/** Admin: approve a pending template → it becomes PUBLIC in the gallery. */
export const approveTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await TemplateMutation.approve(req.params.slug);
  res.json({ success: true, message: 'Template approved and published', data });
});

/** Admin: reject a submission → it returns to PRIVATE (never published). */
export const rejectTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await TemplateMutation.reject(req.params.slug);
  res.json({ success: true, message: 'Template rejected — moved back to private', data });
});

export const getCatalog = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = listCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const data = await TemplateQuery.getCatalog(req.user?.id, {
    category: parsed.data.category,
    search: parsed.data.search,
    tier: parsed.data.tier,
    featured:
      parsed.data.featured !== undefined
        ? parsed.data.featured === 'true'
        : undefined,
  });
  res.json({ success: true, data });
});

export const getTemplateDetail = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await TemplateQuery.getBySlug(req.params.slug);
  res.json({ success: true, data });
});

export const getWorkspacePrivateTemplates = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = privateTemplatesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

    const data = await TemplateQuery.getWorkspacePrivate(req.user!.id, parsed.data.workspaceId);
    res.json({ success: true, data });
  },
);

export const useTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = useTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await TemplateMutation.use(req.user!.id, req.params.slug, parsed.data);
  res.status(201).json({
    success: true,
    message: 'Project created from template',
    data: result,
  });
});

export const rateTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = rateTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await TemplateMutation.rate(
    req.user!.id,
    req.params.slug,
    parsed.data.stars,
  );
  res.json({ success: true, message: 'Template rated', data: result });
});

export const saveAsTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = saveAsTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await TemplateMutation.saveAsTemplate(
    req,
    req.params.projectId,
    parsed.data,
  );
  res.status(201).json({
    success: true,
    message: 'Template saved',
    data: result,
  });
});

export const updateTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await TemplateMutation.update(req, req.params.slug, parsed.data as Record<string, unknown>);
  res.json({ success: true, message: 'Template updated', data: result });
});

export const deleteTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await TemplateMutation.remove(req, req.params.slug);
  res.json({ success: true, message: 'Template deleted', data: result });
});

/** Public template-waitlist request (email capture). */
export const requestTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = templateRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const email = parsed.data.email;
  const existing = await prisma.templateList.findUnique({ where: { email } });
  if (existing) throw new ValidationError('This email is already on the template waitlist');

  try {
    await prisma.templateList.create({ data: { email } });
  } catch (err) {
    // Race-safe duplicate detection: a concurrent POST hitting the unique
    // constraint returns the same 400 contract as the check above.
    if ((err as { code?: string })?.code === 'P2002') {
      throw new ValidationError('This email is already on the template waitlist');
    }
    throw err;
  }
  res.json({ success: true, message: `Thanks! ${email} was added to the template waitlist.` });
});

/** Admin: list template-waitlist emails. */
export const listTemplateRequests = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.templateList.findMany({ select: { email: true } });
  res.json({ success: true, data });
});

/** Admin: remove a template-waitlist email (idempotent). */
export const removeTemplateRequest = asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = req.params.email;
  await prisma.templateList.deleteMany({ where: { email } });
  res.json({ success: true, message: 'Template request removed' });
});
