// src/tests/unit/focusSession/focusSession.analytics.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for focusSession.analytics.ts using the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FocusSessionAnalytics } from '../../../modules/focusSession/focusSession.analytics.js';
import { createUser, createWorkspaceWithOwner, addMemberToWorkspace, createProject, createTask } from '../../../tests/factories/index.js';

describe('FocusSessionAnalytics', () => {
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

  describe('getStats', () => {
    it('returns correct stats for a given period', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      // Session within range
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: new Date('2023-01-15'),
          completed: true,
          endedAt: new Date('2023-01-15T00:30:00Z'),
        },
      });

      // Another session within range
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 60,
          startedAt: new Date('2023-01-20'),
          completed: true,
          endedAt: new Date('2023-01-20T01:00:00Z'),
        },
      });

      // Session outside range (before)
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 10,
          startedAt: new Date('2022-12-31'),
          completed: true,
          endedAt: new Date('2022-12-31T00:10:00Z'),
        },
      });

      // Session outside range (after)
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 10,
          startedAt: new Date('2023-02-01'),
          completed: true,
          endedAt: new Date('2023-02-01T00:10:00Z'),
        },
      });

      const stats = await FocusSessionAnalytics.getStats({
        userId: admin.id,
        startDate,
        endDate,
      });

      expect(stats.totalSessions).toBe(2);
      expect(stats.totalMinutes).toBe(90);
      expect(stats.averageSessionLength).toBe(45);
    });

    it('calculates completedToday correctly', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Session completed today
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: today,
          completed: true,
          endedAt: new Date(),
        },
      });

      // Session completed yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: yesterday,
          completed: true,
          endedAt: new Date(yesterday.setHours(23, 59, 59)),
        },
      });

      const stats = await FocusSessionAnalytics.getStats({ userId: admin.id });
      expect(stats.completedToday).toBe(1);
    });

    it('returns zero stats if no sessions exist', async () => {
      const stats = await FocusSessionAnalytics.getStats({ userId: admin.id });
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalMinutes).toBe(0);
      expect(stats.completedToday).toBe(0);
      expect(stats.averageSessionLength).toBe(0);
    });

    it('ignores date filter if only one date is provided', async () => {
      // Seed two sessions on different days
      await prisma.focusSession.createMany({
        data: [
          {
            userId: admin.id,
            taskId: task.id,
            duration: 30,
            startedAt: new Date('2023-01-01'),
            completed: true,
            endedAt: new Date('2023-01-01T00:30:00Z'),
          },
          {
            userId: admin.id,
            taskId: task.id,
            duration: 60,
            startedAt: new Date('2023-01-02'),
            completed: true,
            endedAt: new Date('2023-01-02T01:00:00Z'),
          },
        ],
      });

      // Provide only startDate
      const stats = await FocusSessionAnalytics.getStats({
        userId: admin.id,
        startDate: new Date('2023-01-01'),
      });

      // Should return both sessions because filter is ignored
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalMinutes).toBe(90);
    });
  });

  describe('getFocusStreak', () => {
    it('returns 0 if no completed sessions', async () => {
      const streak = await FocusSessionAnalytics.getFocusStreak(admin.id);
      expect(streak).toBe(0);
    });

    it('calculates current streak correctly', async () => {
      // Use UTC dates to match implementation logic
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      // Session today (UTC)
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: today,
          completed: true,
          endedAt: new Date(today.getTime() + 1000 * 60 * 30),
        },
      });

      // Session yesterday (UTC)
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: yesterday,
          completed: true,
          endedAt: new Date(yesterday.getTime() + 1000 * 60 * 30),
        },
      });

      // Session two days ago (UTC)
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: twoDaysAgo,
          completed: true,
          endedAt: new Date(twoDaysAgo.getTime() + 1000 * 60 * 30),
        },
      });

      // Session four days ago (UTC - gap)
      const fourDaysAgo = new Date(today);
      fourDaysAgo.setUTCDate(fourDaysAgo.getUTCDate() - 4);
      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: fourDaysAgo,
          completed: true,
          endedAt: new Date(fourDaysAgo.getTime() + 1000 * 60 * 30),
        },
      });

      const streak = await FocusSessionAnalytics.getFocusStreak(admin.id);
      expect(streak).toBe(3);
    });

    it('returns 1 if only today has a session', async () => {
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      await prisma.focusSession.create({
        data: {
          userId: admin.id,
          taskId: task.id,
          duration: 30,
          startedAt: today,
          completed: true,
          endedAt: new Date(today.getTime() + 1000 * 60 * 30),
        },
      });

      const streak = await FocusSessionAnalytics.getFocusStreak(admin.id);
      expect(streak).toBe(1);
    });
  });
});
