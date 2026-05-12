import { prisma } from "../../lib/prisma.js";
import type { CalendarDayAggregate } from "./calendar.types.js";
import type { CalendarFilters } from "./calendar.types.js";
import {
  normalizeDate,
  endOfDay,
  generateDateRange,
  isReviewDay,
} from "./calendar.utils.js";

export const CalendarAggregation = {
  async getOrComputeAggregates(
    filters: CalendarFilters,
  ): Promise<CalendarDayAggregate[]> {
    const { userId, workspaceId, startDate, endDate } = filters;

    const existing = await prisma.calendarDayAggregate.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });

    const existingDates = new Set(
      existing.map((agg) => agg.date.toISOString().split("T")[0]),
    );

    const missingDates = generateDateRange(startDate, endDate).filter(
      (d) => !existingDates.has(d.toISOString().split("T")[0]),
    );

    if (missingDates.length === 0) return existing;

    const rangeStart = missingDates[0];
    const rangeEnd = missingDates[missingDates.length - 1];
    const rangeEndOfDay = endOfDay(rangeEnd);

    await this.computeRangeBatched(
      userId,
      workspaceId,
      rangeStart,
      rangeEndOfDay,
      missingDates,
    );

    return prisma.calendarDayAggregate.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });
  },

  async computeRange(
    userId: string,
    workspaceId: string | undefined,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const dates = generateDateRange(startDate, endDate);
    await this.computeRangeBatched(userId, workspaceId, startDate, endDate, dates);
  },

  /**
   * Fetches ALL data for the date range in 5 queries total (instead of 7×N),
   * then fans out the computation per day in memory.
   */
  async computeRangeBatched(
    userId: string,
    workspaceId: string | undefined,
    rangeStart: Date,
    rangeEnd: Date,
    dates: Date[],
  ): Promise<void> {
    // ── 1. Guard: user must exist ──────────────────────────────────────────
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!userExists) return;

    // ── 2. Fetch everything for the whole range in ONE round-trip ──────────
    const [capacity, tasks, timeEntries, focusSessions, dailyTasks, milestones] =
      await Promise.all([
        prisma.userCapacity.findUnique({ where: { userId } }),

        prisma.task.findMany({
          where: {
            createdById: userId,
            ...(workspaceId ? { workspaceId } : {}),
            OR: [
              { dueDate: { gte: rangeStart, lte: rangeEnd } },
              { startDate: { gte: rangeStart, lte: rangeEnd } },
            ],
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          include: { assignees: true },
        }),

        prisma.timeEntry.findMany({
          where: { userId, startedAt: { gte: rangeStart, lte: rangeEnd } },
        }),

        prisma.focusSession.findMany({
          where: {
            userId,
            startedAt: { gte: rangeStart, lte: rangeEnd },
            completed: true,
          },
        }),

        prisma.dailyTask.findMany({
          where: { userId, date: { gte: rangeStart, lte: rangeEnd } },
        }),

        prisma.projectMilestone.findMany({
          where: {
            dueDate: { gte: rangeStart, lte: rangeEnd },
            project: {
              ...(workspaceId ? { workspaceId } : {}),
              members: { some: { userId } },
            },
          },
        }),
      ]);

    const dailyCapacity = capacity?.dailyCapacityHours ?? 8;

    // ── 3. Build per-day buckets in memory ────────────────────────────────
    const upserts = dates.map((date) => {
      const dayStart = normalizeDate(date);
      const dayEnd = endOfDay(date);

      const dayTasks = tasks.filter(
        (t) =>
          (t.dueDate && t.dueDate >= dayStart && t.dueDate <= dayEnd) ||
          (t.startDate && t.startDate >= dayStart && t.startDate <= dayEnd),
      );

      const dayTimeEntries = timeEntries.filter(
        (e) => e.startedAt >= dayStart && e.startedAt <= dayEnd,
      );

      const dayFocusSessions = focusSessions.filter(
        (s) => s.startedAt >= dayStart && s.startedAt <= dayEnd,
      );

      const dayDailyTasks = dailyTasks.filter(
        (dt) => dt.date >= dayStart && dt.date <= dayEnd,
      );

      const dayMilestones = milestones.filter(
        (m) => m.dueDate && m.dueDate >= dayStart && m.dueDate <= dayEnd,
      );

      const totalTasks = dayTasks.length;
      const dueTasks = dayTasks.filter(
        (t) => t.dueDate && t.dueDate >= dayStart && t.dueDate <= dayEnd,
      ).length;
      const criticalTasks = dayTasks.filter(
        (t) => t.priority === "URGENT" || t.priority === "HIGH",
      ).length;
      const milestoneCount = dayMilestones.length;
      const plannedHours = dayTasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
      const actualHours = dayTimeEntries.reduce((sum, e) => sum + e.duration / 60, 0);
      const focusMinutes = dayFocusSessions.reduce((sum, s) => sum + s.duration, 0);
      const focusRequiredTasks = dayTasks.filter((t) => t.focusRequired).length;
      const workloadScore =
        plannedHours / dailyCapacity + criticalTasks * 0.5 + focusRequiredTasks * 0.3;
      const overCapacity = plannedHours > dailyCapacity;
      const hasPrimaryFocus = dayDailyTasks.some((dt) => dt.type === "PRIMARY");
      const reviewDay = isReviewDay(dayStart);

      return {
        dayStart,
        totalTasks,
        dueTasks,
        criticalTasks,
        milestoneCount,
        plannedHours,
        actualHours,
        focusMinutes,
        workloadScore,
        overCapacity,
        hasPrimaryFocus,
        isReviewDay: reviewDay,
      };
    });

    // ── 4. Write all days in a single transaction ─────────────────────────
    await prisma.$transaction(
      upserts.map(({ dayStart, ...data }) =>
        prisma.calendarDayAggregate.upsert({
          where: { userId_date: { userId, date: dayStart } },
          update: data,
          create: { userId, date: dayStart, ...data },
        }),
      ),
    );
  },

  // recalculateDay kept for targeted single-day invalidation (e.g. after task update)
  async recalculateDay(
    userId: string,
    workspaceId: string | undefined,
    date: Date,
  ): Promise<void> {
    await this.computeRangeBatched(userId, workspaceId, normalizeDate(date), endOfDay(date), [date]);
  },
};