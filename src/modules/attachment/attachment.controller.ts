import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { AttachmentQuery }   from './attachment.query.js';
import { AttachmentMutation } from './attachment.mutation.js';
import {
  getStorageInfo,
  seedWorkspaceStorageFromDb,
} from './attatchment.quota.service.js';
import { prisma }           from '../../lib/prisma.js';
import { WorkspacePlan }    from './attachment.quota.types.js';
import { asyncHandler, BadRequestError, ForbiddenError } from '../../errors/index.js';

export const getTaskAttachments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const attachments = await AttachmentQuery.getTaskAttachments(
    req.params.taskId,
    req.user!.id,
  );
  res.json({ success: true, data: attachments });
});

export const addAttachment = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new BadRequestError('No file provided', 'NO_FILE');

  const file = await AttachmentMutation.addAttachment({
    taskId: req.params.taskId,
    userId: req.user!.id,
    file:   req.file,
  });

  res.status(201).json({ success: true, data: file, message: 'File uploaded successfully' });
});

export const deleteAttachment = asyncHandler(async (req: AuthRequest, res: Response) => {
  await AttachmentMutation.deleteAttachment(req.params.attachmentId, req.user!.id);
  res.json({ success: true, message: 'Attachment deleted successfully' });
});

export const getAttachmentStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await AttachmentQuery.getWorkspaceAttachmentStats(
    req.params.workspaceId,
    req.user!.id,
  );
  res.json({ success: true, data: stats });
});

export const getWorkspaceStorage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId } = req.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: req.user!.id },
  });
  if (!member) throw new ForbiddenError('Not a workspace member');

  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { plan: true } as any,
  });
  const plan = ((ws as any)?.plan ?? 'FREE') as WorkspacePlan;

  const agg = await prisma.file.aggregate({
    where: { workspaceId },
    _sum:  { size: true },
  });
  await seedWorkspaceStorageFromDb(workspaceId, agg._sum.size ?? 0);

  const storage = await getStorageInfo(workspaceId, plan);
  res.json({ success: true, data: storage });
});