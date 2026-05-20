import { Request, Response }               from 'express';
import { createContactMessageSchema }       from './contact.validator.js';
import { createContactMessage,
         getContactMessages,
          }       from './contact.service.js';
import { AuthRequest } from '../../middleware/auth.js';

// ─── Helper ───────────────────────────────────────────────────────────────────
function getRealIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// ─── POST /api/v1/contact ────────────────────────────────────────────────────────
export async function submitContactMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const parsed = createContactMessageSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(422).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Please fix the errors below.',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const ip = getRealIp(req);
    const userAgent = req.headers['user-agent'] ?? '';

    const result = await createContactMessage(parsed.data, ip, userAgent);

    res.status(201).json({
      success: true,
      message: "Your message has been received. We'll get back to you within 2 business days.",
      data: { id: result.id, createdAt: result.createdAt },
    });

  } catch (err) {
    console.error('submitContactMessage error:', err);

    res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again later.',
    });
  }
}

// ─── GET /api/v1/contact ─────────────────────────────────────────────────────────
export async function listContactMessages(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const category =
      typeof req.query.category === 'string' ? req.query.category : undefined;
    const result = await getContactMessages({ page, limit, status, category });

    res.status(200).json({
      success: true,
      ...result,
    });

  } catch (err) {
    console.error('listContactMessages error:', err);

    res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch contact messages.',
    });
  }
}