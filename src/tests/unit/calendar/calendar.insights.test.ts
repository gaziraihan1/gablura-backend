// src/tests/unit/calendar/calendar.insights.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for CalendarInsightsService — real DB.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { CalendarInsightsService } from '../../../modules/calendar/calendar.insights.js';
import { CalendarMutation } from '../../../modules/calendar/calendar.mutation.js';
import {
  createWorkspaceWithOwner,
  createTask,
} from '../../factories/index.js';
import { normalizeDate, endOfDay, getWeekStart } from '../../../modules/calendar/calendar.utils.js';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return normalizeDate(d);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CalendarInsightsService.getInsights', () => {
  it('returns the correct shape with all required fields', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      daysAgo(6),
      new Date(),
    );

    expect(insights).toHaveProperty('totalPlannedHours');
    expect(insights).toHaveProperty('totalCapacityHours');
    expect(insights).toHaveProperty('commitmentGap');
    expect(insights).toHaveProperty('overloadedDays');
    expect(insights).toHaveProperty('focusDays');
    expect(insights).toHaveProperty('burnoutRisk');
    expect(insights).toHaveProperty('timeAllocation');
  });

  it('totalPlannedHours is 0 when there are no tasks', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      daysAgo(6),
      new Date(),
    );

    expect(insights.totalPlannedHours).toBe(0);
  });

  it('totalCapacityHours equals workDays × dailyCapacityHours (default 8h)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    // 7-day range Mon-Fri → 5 work days × 8h = 40h
    // Use a known Mon-Sun span: 2025-06-09 (Mon) to 2025-06-15 (Sun)
    const start = new Date('2025-06-09T00:00:00');
    const end   = new Date('2025-06-15T23:59:59');

    const insights = await CalendarInsightsService.getInsights(
      user.id, workspace.id, start, end,
    );

    expect(insights.totalCapacityHours).toBe(40);
  });

  it('commitmentGap is negative when under-booked', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    // No tasks → plannedHours = 0; capacity > 0 → gap is negative
    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      daysAgo(6),
      new Date(),
    );

    expect(insights.commitmentGap).toBeLessThanOrEqual(0);
  });

  it('overloadedDays increments when a day exceeds capacity', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    const today = normalizeDate(new Date());

    // 10h of tasks on a single day — over 8h default capacity
    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });
    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });

    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      today,
      endOfDay(today),
    );

    expect(insights.overloadedDays).toBeGreaterThanOrEqual(1);
  });

  it('burnoutRisk is one of the valid risk levels', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      daysAgo(6),
      new Date(),
    );

    expect(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).toContain(insights.burnoutRisk);
  });

  it('timeAllocation is null (not yet implemented)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const insights = await CalendarInsightsService.getInsights(
      user.id,
      workspace.id,
      daysAgo(6),
      new Date(),
    );

    expect(insights.timeAllocation).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CalendarInsightsService.calculateBurnoutRisk', () => {
  it('creates or updates a BurnoutSignal row in the DB', async () => {
    const { user } = await createWorkspaceWithOwner();
    const weekStart = getWeekStart(new Date());

    await CalendarInsightsService.calculateBurnoutRisk(user.id, weekStart);

    const signal = await prisma.burnoutSignal.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart } },
    });

    expect(signal).not.toBeNull();
    expect(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).toContain(signal?.riskLevel);
  });

  it('is idempotent — calling twice keeps a single row', async () => {
    const { user } = await createWorkspaceWithOwner();
    const weekStart = getWeekStart(new Date());

    await CalendarInsightsService.calculateBurnoutRisk(user.id, weekStart);
    await CalendarInsightsService.calculateBurnoutRisk(user.id, weekStart);

    const count = await prisma.burnoutSignal.count({
      where: { userId: user.id, weekStart },
    });

    expect(count).toBe(1);
  });

  it('returns LOW risk when the user has no tasks', async () => {
    const { user } = await createWorkspaceWithOwner();

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.riskLevel).toBe('LOW');
    expect(signal.avgDailyLoad).toBe(0);
    expect(signal.consecutiveHeavyDays).toBe(0);
  });
});