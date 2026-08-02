import { describe, it, expect } from "vitest";
import { prisma } from "../../../lib/prisma.js";
import { CalendarQuery } from "../../../modules/calendar/calendar.query.js";
import { CalendarMutation } from "../../../modules/calendar/calendar.mutation.js";
import { createWorkspaceWithOwner, createUser } from "../../factories/index.js";

describe("CalendarQuery.getUserCapacity", () => {
  it("returns null when no capacity exists", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getUserCapacity(user.id);
    expect(result).toBeNull();
  });

  it("returns capacity after initialization", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    const result = await CalendarQuery.getUserCapacity(user.id);
    expect(result).not.toBeNull();
    expect(result?.weeklyHours).toBe(40);
    expect(result?.dailyCapacityHours).toBe(8);
    expect(result?.deepWorkHours).toBe(4);
  });

  it("returns updated values after mutation", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);
    await CalendarMutation.updateCapacity(user.id, { weeklyHours: 25 });

    const result = await CalendarQuery.getUserCapacity(user.id);
    expect(result?.weeklyHours).toBe(25);
  });
});

describe("CalendarQuery.getUserSchedule", () => {
  it("returns null when no schedule exists", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getUserSchedule(user.id);
    expect(result).toBeNull();
  });

  it("returns schedule after initialization", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    const result = await CalendarQuery.getUserSchedule(user.id);
    expect(result).not.toBeNull();
    expect(result?.workDays).toHaveLength(5);
    expect(result?.workStartHour).toBe(9);
    expect(result?.workEndHour).toBe(17);
  });
});

describe("CalendarQuery.getEnergyLevel", () => {
  it("returns null when no entry exists", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getEnergyLevel(user.id, new Date("2025-06-01"));
    expect(result).toBeNull();
  });

  it("returns logged energy entry", async () => {
    const user = await createUser();
    const date = new Date("2025-06-15");
    date.setHours(0, 0, 0, 0);

    await CalendarMutation.logEnergy(user.id, date, 8, "Great day");

    const result = await CalendarQuery.getEnergyLevel(user.id, date);
    expect(result).not.toBeNull();
    expect(result?.energyLevel).toBe(8);
    expect(result?.note).toBe("Great day");
  });
});

describe("CalendarQuery.getEnergyHistory", () => {
  it("returns paginated energy history", async () => {
    const user = await createUser();
    const startDate = new Date("2025-01-01");
    const endDate = new Date("2025-12-31");

    await prisma.energyLevel.createMany({
      data: [
        { userId: user.id, date: new Date("2025-06-01"), energyLevel: 5 },
        { userId: user.id, date: new Date("2025-06-02"), energyLevel: 6 },
        { userId: user.id, date: new Date("2025-06-03"), energyLevel: 7 },
        { userId: user.id, date: new Date("2025-06-04"), energyLevel: 8 },
      ],
    });

    const result = await CalendarQuery.getEnergyHistory(user.id, startDate, endDate, 1, 2);

    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(4);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(2);
    expect(result.pagination.totalPages).toBe(2);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it("returns empty result when no entries exist", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getEnergyHistory(
      user.id,
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );

    expect(result.data).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it("respects user isolation", async () => {
    const userA = await createUser();
    const userB = await createUser();

    await prisma.energyLevel.create({
      data: { userId: userA.id, date: new Date("2025-06-01"), energyLevel: 9 },
    });

    const resultA = await CalendarQuery.getEnergyHistory(userA.id, new Date("2025-01-01"), new Date("2025-12-31"));
    const resultB = await CalendarQuery.getEnergyHistory(userB.id, new Date("2025-01-01"), new Date("2025-12-31"));

    expect(resultA.data).toHaveLength(1);
    expect(resultB.data).toHaveLength(0);
  });
});

describe("CalendarQuery.getEnergyHistoryExport", () => {
  it("returns all energy entries unpaginated ordered oldest first", async () => {
    const user = await createUser();

    await prisma.energyLevel.createMany({
      data: [
        { userId: user.id, date: new Date("2025-06-03"), energyLevel: 7 },
        { userId: user.id, date: new Date("2025-06-01"), energyLevel: 5 },
        { userId: user.id, date: new Date("2025-06-02"), energyLevel: 6, note: "good, focused" },
      ],
    });

    const result = await CalendarQuery.getEnergyHistoryExport(
      user.id,
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );

    expect(result).toHaveLength(3);
    // Oldest first
    expect(result[0].energyLevel).toBe(5);
    expect(result[2].energyLevel).toBe(7);
    // Note preserved
    expect(result[1].note).toBe("good, focused");
  });

  it("filters by date range", async () => {
    const user = await createUser();

    await prisma.energyLevel.createMany({
      data: [
        { userId: user.id, date: new Date("2025-06-01"), energyLevel: 5 },
        { userId: user.id, date: new Date("2025-08-01"), energyLevel: 9 },
      ],
    });

    const result = await CalendarQuery.getEnergyHistoryExport(
      user.id,
      new Date("2025-06-01"),
      new Date("2025-06-30"),
    );

    expect(result).toHaveLength(1);
    expect(result[0].energyLevel).toBe(5);
  });

  it("returns empty array when no entries exist", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getEnergyHistoryExport(
      user.id,
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );
    expect(result).toHaveLength(0);
  });

  it("respects user isolation", async () => {
    const userA = await createUser();
    const userB = await createUser();

    await prisma.energyLevel.create({
      data: { userId: userA.id, date: new Date("2025-06-01"), energyLevel: 9 },
    });

    const resultB = await CalendarQuery.getEnergyHistoryExport(
      userB.id,
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );

    expect(resultB).toHaveLength(0);
  });
});

describe("CalendarQuery.getBurnoutTrends", () => {
  it("returns burnout trends for given weeks", async () => {
    const user = await createUser();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    await prisma.burnoutSignal.createMany({
      data: [
        {
          userId: user.id,
          weekStart: twoWeeksAgo,
          riskLevel: "LOW",
          consecutiveHeavyDays: 0,
          avgDailyLoad: 0.5,
        },
        {
          userId: user.id,
          weekStart: weekAgo,
          riskLevel: "MODERATE",
          consecutiveHeavyDays: 2,
          avgDailyLoad: 0.8,
        },
      ],
    });

    const result = await CalendarQuery.getBurnoutTrends(user.id, 8);

    expect(result).toHaveLength(2);
    expect(result[0].riskLevel).toBe("LOW");
    expect(result[1].avgDailyLoad).toBe(0.8);
  });

  it("returns empty array when no signals exist", async () => {
    const user = await createUser();
    const result = await CalendarQuery.getBurnoutTrends(user.id, 4);
    expect(result).toHaveLength(0);
  });
});
