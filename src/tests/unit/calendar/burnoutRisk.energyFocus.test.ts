// src/tests/unit/calendar/burnoutRisk.energyFocus.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the deepened burnout scoring — energy logs and completed
// focus sessions now influence the risk level and are stored on the signal.
// Real DB, mirrors calendar.insights.test.ts conventions.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { CalendarInsightsService } from '../../../modules/calendar/calendar.insights.js';
import { createWorkspaceWithOwner } from '../../factories/index.js';
import { getWeekStart, normalizeDate } from '../../../modules/calendar/calendar.utils.js';

/**
 * The service buckets weeks from `getWeekStart` (which lands on the
 * preceding Sunday, or on Sunday itself when today is a Sunday). Derive the
 * first Monday inside that bucket, then add `offset` workdays (0 = Mon …
 * 4 = Fri) so fixtures always land on workdays of the week being scored.
 */
function weekDay(offset: number): Date {
  const ws = normalizeDate(getWeekStart(new Date()));
  const monday = new Date(ws);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7));
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return d;
}

async function logEnergy(userId: string, date: Date, level: number) {
  await prisma.energyLevel.create({
    data: { userId, date, energyLevel: level },
  });
}

async function logFocus(userId: string, startedAt: Date, duration: number) {
  await prisma.focusSession.create({
    data: { userId, startedAt, duration, completed: true },
  });
}

describe('CalendarInsightsService.calculateBurnoutRisk — energy factor', () => {
  it('stores avgEnergy, lowEnergyDays and escalates risk with low-energy days', async () => {
    const { user } = await createWorkspaceWithOwner();

    // No tasks (load 0) — only strain comes from two low-energy workdays
    // (Monday + Wednesday, separated by a normal Tuesday).
    await logEnergy(user.id, weekDay(0), 3); // Mon
    await logEnergy(user.id, weekDay(2), 3); // Wed

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.lowEnergyDays).toBe(2);
    expect(signal.avgEnergy).toBe(3);
    expect(signal.riskLevel).toBe('MODERATE'); // 2 heavy days → MODERATE
    expect(signal.avgDailyLoad).toBe(0.9); // 2×0.2 + 0.5 (avg ≤ 4)
    expect(signal.consecutiveHeavyDays).toBe(1); // Tue breaks the run
  });

  it('escalates to HIGH when most workdays are low-energy', async () => {
    const { user } = await createWorkspaceWithOwner();

    // Four low-energy workdays (Mon-Thu) with no task load.
    for (let i = 0; i < 4; i++) {
      await logEnergy(user.id, weekDay(i), 3);
    }

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.lowEnergyDays).toBe(4);
    expect(signal.avgDailyLoad).toBe(1.3); // 4×0.2 + 0.5
    expect(signal.riskLevel).toBe('HIGH');
  });

  it('ignores energy logs when the user has none', async () => {
    const { user } = await createWorkspaceWithOwner();

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.avgEnergy).toBeNull();
    expect(signal.lowEnergyDays).toBe(0);
    expect(signal.riskLevel).toBe('LOW');
    expect(signal.avgDailyLoad).toBe(0);
  });
});

describe('CalendarInsightsService.calculateBurnoutRisk — focus factor', () => {
  it('stores focus minutes and escalates risk with focus-overload days', async () => {
    const { user } = await createWorkspaceWithOwner();

    // Two 6h+ deep-focus days (Monday + Wednesday), no task load.
    await logFocus(user.id, weekDay(0), 400);
    await logFocus(user.id, weekDay(2), 420);

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.focusMinutes).toBe(820);
    expect(signal.focusOverloadDays).toBe(2);
    expect(signal.riskLevel).toBe('MODERATE'); // 2 heavy days → MODERATE
    expect(signal.avgDailyLoad).toBe(0.6); // 2×0.3
  });

  it('does not count short focus sessions as overload', async () => {
    const { user } = await createWorkspaceWithOwner();

    await logFocus(user.id, weekDay(0), 120);
    await logFocus(user.id, weekDay(1), 90);

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    expect(signal.focusMinutes).toBe(210);
    expect(signal.focusOverloadDays).toBe(0);
    expect(signal.riskLevel).toBe('LOW');
  });
});

describe('CalendarInsightsService.calculateBurnoutRisk — combined strain', () => {
  it('blends energy and focus strain into the stored load', async () => {
    const { user } = await createWorkspaceWithOwner();

    // One low-energy day (Mon) + one focus-overload day (Wed).
    await logEnergy(user.id, weekDay(0), 3);
    await logFocus(user.id, weekDay(2), 380);

    const signal = await CalendarInsightsService.calculateBurnoutRisk(
      user.id,
      getWeekStart(new Date()),
    );

    // energyRisk = 1×0.2 + 0.5 = 0.7, focusRisk = 1×0.3 = 0.3 → 1.0
    expect(signal.avgDailyLoad).toBe(1.0);
    expect(signal.lowEnergyDays).toBe(1);
    expect(signal.focusOverloadDays).toBe(1);
    expect(signal.riskLevel).toBe('MODERATE'); // load > 1.0 → MODERATE
  });
});
