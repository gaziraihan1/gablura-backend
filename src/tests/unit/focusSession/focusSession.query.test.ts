// src/tests/unit/focusSession/focusSession.query.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for focusSession.query.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FocusSessionQuery } from '../../../modules/focusSession/focusSession.query.js';
import { createUser, createWorkspaceWithOwner, addMemberToWorkspace, createProject, createTask } from '../../../tests/factories/index.js';

describe('FocusSessionQuery', () => {
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

  describe('getActiveSession', () => {
    it('returns the most recent active session', async () => {
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 25,
          startedAt: new Date('2023-01-01'),
        },
      });
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 25,
          startedAt: new Date('2023-01-02'),
        },
      });

      const session = await FocusSessionQuery.getActiveSession(admin.id);
      expect(session).not.toBeNull();
      expect(session!.startedAt.toISOString()).toBe(new Date('2023-01-02').toISOString());
    });

    it('returns null if no active session exists', async () => {
      const session = await FocusSessionQuery.getActiveSession(admin.id);
      expect(session).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns completed sessions ordered by startedAt desc', async () => {
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 25,
          startedAt: new Date('2023-01-01'),
          completed: true,
          endedAt: new Date('2023-01-01T00:25:00Z'),
        },
      });
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 25,
          startedAt: new Date('2023-01-02'),
          completed: true,
          endedAt: new Date('2023-01-02T00:25:00Z'),
        },
      });

      const history = await FocusSessionQuery.getHistory({ userId: admin.id });
      expect(history).toHaveLength(2);
      expect(history[0].startedAt.toISOString()).toBe(new Date('2023-01-02').toISOString());
    });

    it('respects the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.focusSession.create({
          data: {
            userId: admin.id,
            taskId: task.id,
            duration: 25,
            startedAt: new Date(2023, 0, i + 1),
            completed: true,
            endedAt: new Date(2023, 0, i + 1, 0, 25),
          },
        });
      }

      const history = await FocusSessionQuery.getHistory({ userId: admin.id, limit: 2 });
      expect(history).toHaveLength(2);
    });
  });
});
