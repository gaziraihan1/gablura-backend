import { Response }        from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { MeetingService }   from './meeting.service.js';
import { prisma }           from '../../lib/prisma.js';
import { asyncHandler, ValidationError, ForbiddenError } from '../../errors/index.js';
import {
  createMeetingSchema,
  updateMeetingSchema,
  listMeetingsSchema,
} from './meeting.validator.js';

// ─── Shared context resolver ──────────────────────────────────────────────────
// Looks up the caller's workspace role. Throws ForbiddenError if not a member.

async function resolveCtx(req: AuthRequest, workspaceId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where:  { userId: req.user!.id, workspaceId },
    select: { role: true },
  });

  if (!member) throw new ForbiddenError('You are not a member of this workspace');

  return {
    userId:        req.user!.id,
    workspaceId,
    workspaceRole: member.role,
  };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export class MeetingController {
  static list = asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = listMeetingsSchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

    const ctx     = await resolveCtx(req, req.params.workspaceId);
    const result  = await MeetingService.list(ctx, parsed.data);
    res.json({ success: true, data: result });
  });

  static getById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ctx     = await resolveCtx(req, req.params.workspaceId);
    const meeting = await MeetingService.getById(ctx, req.params.meetingId);
    res.json({ success: true, data: meeting });
  });

  static create = asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = createMeetingSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

    const ctx     = await resolveCtx(req, req.params.workspaceId);
    const meeting = await MeetingService.create(ctx, parsed.data, req.user!.name ?? 'Someone');
    res.status(201).json({ success: true, data: meeting });
  });

  static update = asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = updateMeetingSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

    const ctx     = await resolveCtx(req, req.params.workspaceId);
    const meeting = await MeetingService.update(ctx, req.params.meetingId, parsed.data, req.user!.name ?? 'Someone');
    res.json({ success: true, data: meeting });
  });

  static cancel = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ctx     = await resolveCtx(req, req.params.workspaceId);
    const meeting = await MeetingService.cancel(ctx, req.params.meetingId, req.user!.name ?? 'Someone');
    res.json({ success: true, data: meeting });
  });

  static delete = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ctx = await resolveCtx(req, req.params.workspaceId);
    await MeetingService.delete(ctx, req.params.meetingId);
    res.json({ success: true });
  });
}