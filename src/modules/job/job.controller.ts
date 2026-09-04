import { Request, Response }   from 'express';
import type { AuthRequest }    from '../../middleware/auth.js';
import { isGabluraAdminUser }   from '../../config/admin.config.js';
import {
  listOpenJobs, getOpenJob,
  createJob, updateJob,
  deleteJob, listAllJobs,
  togglePin,
} from './job.service.js';
import {
  createJobSchema,
  updateJobSchema,
  listJobsQuerySchema,
} from './job.validator.js';
import {
  asyncHandler,
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../errors/index.js';

// ─── Guard ────────────────────────────────────────────────────────────────────

function assertAdmin(userId: string | undefined, role: string | undefined): void {
  if (!isGabluraAdminUser(role, userId)) {
    throw new ForbiddenError('You do not have permission to access this resource.');
  }
}

// ─── Public ───────────────────────────────────────────────────────────────────
export const publicListJobs = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.flatten().fieldErrors as any[]);
  }

  const result = await listOpenJobs(parsed.data);
  res.json({ 
    success: true, 
    data: result.jobs, 
    pagination: result.pagination 
  });
});

export const publicGetJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await getOpenJob(req.params.slug);
  if (!job) throw new NotFoundError('Job');
  res.json({ success: true, data: job });
});

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminListJobs = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertAdmin(req.user?.id, req.user?.role);

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  const result = await listAllJobs(page, limit);
  res.json({ 
    success: true, 
    data: result.jobs, 
    pagination: result.pagination 
  });
});

export const adminCreateJob = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertAdmin(req.user?.id, req.user?.role);

  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.flatten().fieldErrors as any[]);
  }

  const job = await createJob(parsed.data, req.user!.id);
  res.status(201).json({ success: true, message: 'Job posting created.', data: job });
});

export const adminUpdateJob = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertAdmin(req.user?.id, req.user?.role);

  const parsed = updateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.flatten().fieldErrors as any[]);
  }

  const job = await updateJob(req.params.id, parsed.data);
  if (!job) throw new NotFoundError('Job');

  res.json({ success: true, message: 'Job posting updated.', data: job });
});

export const adminDeleteJob = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertAdmin(req.user?.id, req.user?.role);

  const deleted = await deleteJob(req.params.id);
  if (!deleted) throw new NotFoundError('Job');

  res.json({ success: true, message: 'Job posting deleted.' });
});

export const adminTogglePin = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertAdmin(req.user?.id, req.user?.role);

  const job = await togglePin(req.params.id);
  if (!job) throw new NotFoundError('Job');

  res.json({
    success: true,
    message: `Job ${job.isPinned ? 'pinned' : 'unpinned'}.`,
    data:    job,
  });
});