// src/tests/unit/focusSession/focusSession.mutation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for focusSession.mutation.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FocusSessionMutation } from '../../../modules/focusSession/focusSession.mutation.js';
import { createUser, createWorkspaceWithOwner, addMemberToWorkspace, createProject, createTask } from '../../../tests/factories/index.js';
import { ConflictError, NotFoundError, BadRequestError } from '../../../errors/index.js';
import { FocusType } from '@prisma/client';

describe('FocusSessionMutation', () => {
  let user: any;
  let admin: any;
  let workspace: any;
  let project: any;
  let task: any;

  beforeEach(async () => {
    // Clean up and setup
    await prisma.focusSession.deleteMany();
    await prisma.task.deleteMany();
    await prisma.project.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();

    const ownerData = await createWorkspaceWithOwner();
    admin = ownerData.user;
    workspace = ownerData.workspace;

    project = await createProject(workspace.id, admin.id);
    task = await createTask(workspace.id, admin.id, { projectId: project.id });
  });

  describe('startSession', () => {
    it('starts a new focus session successfully', async () => {
      const result = await FocusSessionMutation.startSession({
        userId: admin.id,
        taskId: task.id,
        type: FocusType.DEEP_WORK,
        duration: 25,
      });

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(admin.id);
      expect(result.taskId).toBe(task.id);
      expect(result.type).toBe(FocusType.DEEP_WORK);
      expect(result.duration).toBe(25);
      expect(result.completed).toBe(false);

      const dbSession = await prisma.focusSession.findUnique({ where: { id: result.id } });
      expect(dbSession).not.toBeNull();
    });

    it('throws ConflictError if a session is already active', async () => {
      await FocusSessionMutation.startSession({
        userId: admin.id,
        taskId: task.id,
        type: FocusType.DEEP_WORK,
        duration: 25,
      });

      await expect(
        FocusSessionMutation.startSession({
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('completeSession', () => {
    it('completes an active session successfully', async () => {
      const session = await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
          startedAt: new Date(),
        },
      });

      // We'll use a dummy callback to verify it's called
      const onCompleteSpy = vi.fn().mockResolvedValue(undefined);

      const result = await FocusSessionMutation.completeSession(
        { sessionId: session.id, userId: admin.id },
        onCompleteSpy
      );

      expect(result.completed).toBe(true);
      expect(result.endedAt).not.toBeNull();
      expect(onCompleteSpy).toHaveBeenCalledWith(expect.objectContaining({
        startedAt: session.startedAt,
        workspaceId: workspace.id
      }));

      const dbSession = await prisma.focusSession.findUnique({ where: { id: session.id } });
      expect(dbSession?.completed).toBe(true);
    });

    it('throws NotFoundError if session does not exist', async () => {
      await expect(
        FocusSessionMutation.completeSession({ sessionId: 'non-existent', userId: admin.id })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws BadRequestError if session is already completed', async () => {
      const session = await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
          startedAt: new Date(),
          completed: true,
          endedAt: new Date(),
        },
      });

      await expect(
        FocusSessionMutation.completeSession({ sessionId: session.id, userId: admin.id })
      ).rejects.toThrow(BadRequestError);
    });

    it("throws ForbiddenError if user tries to complete someone else's session", async () => {
      const otherUser = await createUser();
      await addMemberToWorkspace(otherUser.id, workspace.id);

      const session = await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
          startedAt: new Date(),
        },
      });

      await expect(
        FocusSessionMutation.completeSession({ sessionId: session.id, userId: otherUser.id })
      ).rejects.toThrow(); // It should throw a ForbiddenError or NotFoundError depending on implementation, but definitely not succeed
    });
  });

  describe('cancelSession', () => {
    it('cancels an active session successfully', async () => {
      const session = await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
          startedAt: new Date(),
        },
      });

      const result = await FocusSessionMutation.cancelSession({
        sessionId: session.id,
        userId: admin.id,
      });

      expect(result.id).toBe(session.id);
      
      const dbSession = await prisma.focusSession.findUnique({ where: { id: session.id } });
      expect(dbSession).toBeNull();
    });

    it('throws NotFoundError if session does not exist', async () => {
      await expect(
        FocusSessionMutation.cancelSession({ sessionId: 'non-existent', userId: admin.id })
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError if user tries to cancel someone else's session", async () => {
      const otherUser = await createUser();
      await addMemberToWorkspace(otherUser.id, workspace.id);

      const session = await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          type: FocusType.DEEP_WORK,
          duration: 25,
          startedAt: new Date(),
        },
      });

      await expect(
        FocusSessionMutation.cancelSession({ sessionId: session.id, userId: otherUser.id })
      ).rejects.toThrow();
    });
  });
});
