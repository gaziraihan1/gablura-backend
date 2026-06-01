import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { FocusSessionQuery }     from './focusSession.query.js';
import { FocusSessionMutation }  from './focusSession.mutation.js';
import { FocusSessionAnalytics } from './focusSession.analytics.js';
import { CalendarAggregation }   from '../calendar/calendar.aggregation.js';
import { asyncHandler, ValidationError, ConflictError } from '../../errors/index.js';
import {
  startSessionSchema,
  getHistorySchema,
  getStatsSchema,
} from './focusSession.validators.js';

export const startSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  try {
    const session = await FocusSessionMutation.startSession({
      userId: req.user!.id,
      ...parsed.data,
    });
    res.status(201).json({ success: true, data: session, message: 'Focus session started' });
  } catch (err) {
    // USER_HAS_ACTIVE_SESSION carries the active session in meta — include it in the response
    if (err instanceof ConflictError && err.code === 'USER_HAS_ACTIVE_SESSION') {
      return res.status(409).json({
        success: false,
        message: err.message,
        code:    err.code,
        data:    (err.meta as any)?.activeSession ?? null,
      });
    }
    throw err; // anything else → errorHandler
  }
});

export const completeSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = await FocusSessionMutation.completeSession(
    { sessionId: req.params.id, userId: req.user!.id },
    async ({ startedAt, workspaceId }) => {
      await CalendarAggregation.recalculateDay(req.user!.id, workspaceId!, startedAt);
    },
  );

  res.json({ success: true, data: session, message: 'Focus session completed' });
});

export const cancelSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  await FocusSessionMutation.cancelSession({
    sessionId: req.params.id,
    userId:    req.user!.id,
  });
  res.json({ success: true, message: 'Focus session cancelled' });
});

export const getActiveSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = await FocusSessionQuery.getActiveSession(req.user!.id);
  res.json({ success: true, data: session });
});

export const getHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getHistorySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const sessions = await FocusSessionQuery.getHistory({
    userId: req.user!.id,
    limit:  parsed.data.limit,
  });

  res.json({ success: true, data: sessions });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getStatsSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { startDate, endDate } = parsed.data;

  const [stats, focusStreak] = await Promise.all([
    FocusSessionAnalytics.getStats({ userId: req.user!.id, startDate, endDate }),
    FocusSessionAnalytics.getFocusStreak(req.user!.id),
  ]);

  res.json({ success: true, data: { ...stats, focusStreak } });
});