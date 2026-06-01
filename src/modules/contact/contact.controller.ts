import { Request, Response }         from 'express';
import type { AuthRequest }           from '../../middleware/auth.js';
import { createContactMessageSchema } from './contact.validator.js';
import { createContactMessage, getContactMessages } from './contact.service.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

function getRealIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// ─── POST /api/v1/contact ─────────────────────────────────────────────────────

export const submitContactMessage = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createContactMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please fix the errors below.', parsed.error.flatten().fieldErrors as any[], 'VALIDATION_ERROR');
  }

  const result = await createContactMessage(
    parsed.data,
    getRealIp(req),
    req.headers['user-agent'] ?? '',
  );

  res.status(201).json({
    success: true,
    message: "Your message has been received. We'll get back to you within 2 business days.",
    data: { id: result.id, createdAt: result.createdAt },
  });
});

// ─── GET /api/v1/contact ──────────────────────────────────────────────────────

export const listContactMessages = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page     = Math.max(1, Number(req.query.page)  || 1);
  const limit    = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status   = typeof req.query.status   === 'string' ? req.query.status   : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;

  const result = await getContactMessages({ page, limit, status, category });

  res.json({ success: true, ...result });
});