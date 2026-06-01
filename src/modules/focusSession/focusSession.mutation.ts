import { prisma }          from '../../lib/prisma.js';
import type {
  CreateFocusSessionInput,
  CompleteFocusSessionInput,
  CancelFocusSessionInput,
} from './focusSession.types.js';
import { FocusSessionQuery } from './focusSession.query.js';
import { sessionWithIdTitle } from './focusSession.selects.js';
import { ConflictError, NotFoundError, BadRequestError } from '../../errors/index.js';

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

    return prisma.focusSession.create({
      data: {
        userId:    input.userId,
        taskId:    input.taskId,
        type:      input.type,
        duration:  input.duration,
        startedAt: new Date(),
      },
      include: sessionWithIdTitle,
    });
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
    return session;
  },
};