import { prisma }          from '../../lib/prisma.js';
import type {
  CreateFocusSessionInput,
  CompleteFocusSessionInput,
  CancelFocusSessionInput,
} from './focusSession.types.js';
import { FocusSessionQuery } from './focusSession.query.js';
import { sessionWithIdTitle } from './focusSession.selects.js';
import { ConflictError, NotFoundError, BadRequestError } from '../../errors/index.js';
import { CalendarCache, FocusSessionCache } from '../../lib/redis/cache.client.js';

export const FocusSessionMutation = {
  async startSession(input: CreateFocusSessionInput) {
    const active = await FocusSessionQuery.getActiveSession(input.userId);
    if (active) {
      // Carry the active session in meta so the controller can return it to the client
      throw new ConflictError(
        'You already have an active focus session',
        'USER_HAS_ACTIVE_SESSION',
        { activeSession: active },
      );
    }

    // Validate taskId exists and user has access before creating
    if (input.taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: input.taskId,
          OR: [
            { createdById: input.userId },
            { assignees: { some: { userId: input.userId } } },
            { project: { members: { some: { userId: input.userId } } } },
            {
              project: {
                workspace: {
                  OR: [
                    { ownerId: input.userId },
                    { members: { some: { userId: input.userId } } },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    }

    const session = await prisma.focusSession.create({
      data: {
        userId:    input.userId,
        taskId:    input.taskId,
        type:      input.type,
        duration:  input.duration,
        startedAt: new Date(),
      },
      include: sessionWithIdTitle,
    });

    // Invalidate active session cache (new session started)
    FocusSessionCache.invalidateActiveSession(input.userId).catch(() => {});

    return session;
  },

  async completeSession(
    input: CompleteFocusSessionInput,
    onComplete?: (session: { startedAt: Date; workspaceId?: string }) => Promise<void>,
  ) {
    const session = await prisma.focusSession.findFirst({
      where:   { id: input.sessionId, userId: input.userId },
      include: { task: true },
    });

    if (!session) throw new NotFoundError('Focus session', 'SESSION_NOT_FOUND');
    if (session.completed) throw new BadRequestError('Focus session already completed', 'SESSION_ALREADY_COMPLETED');

    const updated = await prisma.focusSession.update({
      where:   { id: input.sessionId },
      data:    { completed: true, endedAt: new Date() },
      include: { task: true },
    });

    // Invalidate caches
    const workspaceId = session.task?.workspaceId;
    Promise.all([
      // Focus session caches
      FocusSessionCache.invalidateActiveSession(input.userId),
      FocusSessionCache.invalidateHistory(input.userId),
      FocusSessionCache.invalidateStats(input.userId),
      FocusSessionCache.invalidateStreak(input.userId),
      FocusSessionCache.invalidateDailySummary(input.userId),
      // Calendar caches (focus sessions affect aggregates)
      CalendarCache.invalidateAggregates(input.userId, workspaceId ?? undefined),
      CalendarCache.invalidateInsights(input.userId, workspaceId ?? undefined),
    ]).catch((err) => console.error('[Cache] Failed to invalidate after session completion:', err));

    if (onComplete) {
      onComplete({
        startedAt:   session.startedAt,
        workspaceId: session.task?.workspaceId ?? undefined,
      }).catch((err) => {
        console.error('Post-completion callback failed:', err);
      });
    }

    return updated;
  },

  async cancelSession(input: CancelFocusSessionInput) {
    const session = await prisma.focusSession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
    });

    if (!session) throw new NotFoundError('Focus session', 'SESSION_NOT_FOUND');

    await prisma.focusSession.delete({ where: { id: input.sessionId } });

    // Invalidate caches
    FocusSessionCache.invalidateActiveSession(input.userId).catch((err) => console.error('[FocusSession] Failed to invalidate active session cache:', err));
    FocusSessionCache.invalidateHistory(input.userId).catch((err) => console.error('[FocusSession] Failed to invalidate history cache:', err));
    FocusSessionCache.invalidateDailySummary(input.userId).catch((err) => console.error('[FocusSession] Failed to invalidate daily summary cache:', err));

    return session;
  },
};