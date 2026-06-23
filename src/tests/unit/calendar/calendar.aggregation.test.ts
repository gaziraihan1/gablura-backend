// src/tests/unit/calendar/calendar.aggregation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for CalendarAggregation — real DB, no HTTP.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { CalendarAggregation } from '../../../modules/calendar/calendar.aggregation.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createTask,
} from '../../factories/index.js';
import { normalizeDate, endOfDay } from '../../../modules/calendar/calendar.utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return normalizeDate(d);
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return normalizeDate(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrComputeAggregates
// ─────────────────────────────────────────────────────────────────────────────

describe('CalendarAggregation.getOrComputeAggregates', () => {
  it('returns an array (empty or computed) for a valid date range', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await CalendarAggregation.getOrComputeAggregates({
      userId:      user.id,
      workspaceId: workspace.id,
      startDate:   daysAgo(3),
      endDate:     new Date(),
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('creates aggregate rows in the DB for missing dates', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const start = daysAgo(2);
    const end   = new Date();

    await CalendarAggregation.getOrComputeAggregates({
      userId:      user.id,
      workspaceId: workspace.id,
      startDate:   start,
      endDate:     end,
    });

    const count = await prisma.calendarDayAggregate.count({
      where: { userId: user.id, date: { gte: start, lte: end } },
    });

    // Should have one row per day in the range (3 days: -2, -1, today)
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('does not duplicate rows when called twice for the same range', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const start = daysAgo(1);
    const end   = new Date();

    await CalendarAggregation.getOrComputeAggregates({
      userId: user.id, workspaceId: workspace.id, startDate: start, endDate: end,
    });
    await CalendarAggregation.getOrComputeAggregates({
      userId: user.id, workspaceId: workspace.id, startDate: start, endDate: end,
    });

    const count = await prisma.calendarDayAggregate.count({
      where: { userId: user.id, date: { gte: start, lte: end } },
    });

    expect(count).toBe(2); // today + yesterday, no duplication
  });

  it('silently returns early when the userId does not exist', async () => {
    const result = await CalendarAggregation.getOrComputeAggregates({
      userId:    'non-existent-user-id',
      startDate: daysAgo(1),
      endDate:   new Date(),
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('aggregates reflect task data (plannedHours from estimatedHours)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    await createTask(workspace.id, user.id, {
      estimatedHours: 3,
      dueDate:        today,
    });

    await CalendarAggregation.getOrComputeAggregates({
      userId:      user.id,
      workspaceId: workspace.id,
      startDate:   today,
      endDate:     endOfDay(today),
    });

    const agg = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    expect(agg).not.toBeNull();
    expect(agg!.plannedHours).toBeGreaterThanOrEqual(3);
  });

  it('marks overCapacity: true when plannedHours exceeds daily capacity', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    // Set daily capacity to 8h (default), create tasks totalling > 8h
    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });
    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });

    await CalendarAggregation.getOrComputeAggregates({
      userId:      user.id,
      workspaceId: workspace.id,
      startDate:   today,
      endDate:     endOfDay(today),
    });

    const agg = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    expect(agg?.overCapacity).toBe(true);
  });

  it('respects custom daily capacity from UserCapacity record', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    // Set a very low daily capacity of 2h
    await prisma.userCapacity.upsert({
      where:  { userId: user.id },
      update: { dailyCapacityHours: 2 },
      create: { userId: user.id, weeklyHours: 10, dailyCapacityHours: 2, deepWorkHours: 1 },
    });

    await createTask(workspace.id, user.id, { estimatedHours: 3, dueDate: today });

    await CalendarAggregation.getOrComputeAggregates({
      userId:      user.id,
      workspaceId: workspace.id,
      startDate:   today,
      endDate:     endOfDay(today),
    });

    const agg = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    expect(agg?.overCapacity).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recalculateDay
// ─────────────────────────────────────────────────────────────────────────────

describe('CalendarAggregation.recalculateDay', () => {
  it('creates or updates the aggregate for a specific day', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    await CalendarAggregation.recalculateDay(user.id, workspace.id, today);

    const agg = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    expect(agg).not.toBeNull();
  });

  it('updates an existing aggregate rather than creating a duplicate', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    await CalendarAggregation.recalculateDay(user.id, workspace.id, today);
    await CalendarAggregation.recalculateDay(user.id, workspace.id, today);

    const count = await prisma.calendarDayAggregate.count({
      where: { userId: user.id, date: today },
    });

    expect(count).toBe(1);
  });

  it('reflects newly added tasks on recalculation', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    // First pass — no tasks
    await CalendarAggregation.recalculateDay(user.id, workspace.id, today);
    const before = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    // Add a task, then recalculate
    await createTask(workspace.id, user.id, { estimatedHours: 4, dueDate: today });
    await CalendarAggregation.recalculateDay(user.id, workspace.id, today);
    const after = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id, date: today },
    });

    expect(after!.plannedHours).toBeGreaterThan(before!.plannedHours);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRange
// ─────────────────────────────────────────────────────────────────────────────

describe('CalendarAggregation.computeRange', () => {
  it('creates one aggregate row per day in the range', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const start = daysAgo(4);
    const end   = daysAgo(0);

    await CalendarAggregation.computeRange(user.id, workspace.id, start, end);

    const count = await prisma.calendarDayAggregate.count({
      where: { userId: user.id, date: { gte: start, lte: end } },
    });

    expect(count).toBe(5); // 4 days ago through today
  });

  it('does not create rows for other users', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const other = await createUser();
    const start = daysAgo(2);
    const end   = new Date();

    await CalendarAggregation.computeRange(user.id, workspace.id, start, end);

    const otherCount = await prisma.calendarDayAggregate.count({
      where: { userId: other.id },
    });

    expect(otherCount).toBe(0);
  });
});