import { describe, it, expect } from "vitest";
import { prisma } from "../../../lib/prisma.js";
import { CalendarMutation } from "../../../modules/calendar/calendar.mutation.js";
import { createWorkspaceWithOwner, createUser } from "../../factories/index.js";

describe("CalendarMutation.createGoalCheckpoint", () => {
  it("creates a goal checkpoint successfully", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const result = await CalendarMutation.createGoalCheckpoint({
      userId: user.id,
      workspaceId: workspace.id,
      title: "Finish roadmap",
      type: "WEEKLY",
      targetDate: new Date(),
    });

    expect(result).toBeDefined();
    expect(result.userId).toBe(user.id);
    expect(result.workspaceId).toBe(workspace.id);
    expect(result.title).toBe("Finish roadmap");
  });

  it("persists data in database", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const created = await CalendarMutation.createGoalCheckpoint({
      userId: user.id,
      workspaceId: workspace.id,
      title: "Persist test",
      type: "WEEKLY",
      targetDate: new Date(),
    });

    const found = await prisma.goalCheckpoint.findUnique({
      where: { id: created.id },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });
});

describe("CalendarMutation.initializeUserSettings", () => {
  it("creates user capacity and work schedule", async () => {
    const { user } = await createWorkspaceWithOwner();

    await CalendarMutation.initializeUserSettings(user.id);

    const capacity = await prisma.userCapacity.findUnique({
      where: { userId: user.id },
    });

    const schedule = await prisma.userWorkSchedule.findUnique({
      where: { userId: user.id },
    });

    expect(capacity).not.toBeNull();
    expect(schedule).not.toBeNull();

    expect(capacity?.weeklyHours).toBe(40);
    expect(schedule).toBeTruthy();
    expect(schedule!.workDays).toHaveLength(5);
  });

  it("does not duplicate settings on re-run", async () => {
    const { user } = await createWorkspaceWithOwner();

    await CalendarMutation.initializeUserSettings(user.id);
    await CalendarMutation.initializeUserSettings(user.id);

    const capacityCount = await prisma.userCapacity.count({
      where: { userId: user.id },
    });

    const scheduleCount = await prisma.userWorkSchedule.count({
      where: { userId: user.id },
    });

    expect(capacityCount).toBe(1);
    expect(scheduleCount).toBe(1);
  });
});

describe("CalendarMutation.updateCapacity", () => {
  it("creates capacity if missing", async () => {
    const user = await createUser();

    const result = await CalendarMutation.updateCapacity(user.id, {
      weeklyHours: 30,
      dailyCapacityHours: 6,
    });

    expect(result.weeklyHours).toBe(30);
    expect(result.dailyCapacityHours).toBe(6);
    expect(result.deepWorkHours).toBe(4);
  });

  it("updates existing capacity", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    const result = await CalendarMutation.updateCapacity(user.id, {
      weeklyHours: 20,
    });

    expect(result.weeklyHours).toBe(20);
    expect(result.dailyCapacityHours).toBe(8);
  });

  it("persists updated values in database", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    await CalendarMutation.updateCapacity(user.id, {
      weeklyHours: 35,
      dailyCapacityHours: 7,
      deepWorkHours: 3,
    });

    const db = await prisma.userCapacity.findUnique({ where: { userId: user.id } });
    expect(db?.weeklyHours).toBe(35);
    expect(db?.dailyCapacityHours).toBe(7);
    expect(db?.deepWorkHours).toBe(3);
  });
});

describe("CalendarMutation.updateSchedule", () => {
  it("creates schedule if missing", async () => {
    const user = await createUser();

    const result = await CalendarMutation.updateSchedule(user.id, {
      workDays: ["MON", "WED", "FRI"],
      workStartHour: 10,
      workEndHour: 16,
    });

    expect(result.workDays).toEqual(["MON", "WED", "FRI"]);
    expect(result.workStartHour).toBe(10);
    expect(result.workEndHour).toBe(16);
  });

  it("updates existing schedule", async () => {
    const { user } = await createWorkspaceWithOwner();
    await CalendarMutation.initializeUserSettings(user.id);

    const result = await CalendarMutation.updateSchedule(user.id, {
      workStartHour: 8,
    });

    expect(result.workStartHour).toBe(8);
    expect(result.workEndHour).toBe(17);
  });

  it("persists timezone", async () => {
    const user = await createUser();

    const result = await CalendarMutation.updateSchedule(user.id, {
      workDays: ["MON", "TUE", "WED", "THU", "FRI"],
      workStartHour: 9,
      workEndHour: 18,
      timezone: "America/New_York",
    });

    expect(result.timezone).toBe("America/New_York");
  });
});

describe("CalendarMutation.logEnergy", () => {
  it("creates an energy log entry", async () => {
    const user = await createUser();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await CalendarMutation.logEnergy(user.id, today, 7, "Feeling good");

    expect(result.energyLevel).toBe(7);
    expect(result.note).toBe("Feeling good");
    expect(result.userId).toBe(user.id);
  });

  it("upserts on same day", async () => {
    const user = await createUser();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await CalendarMutation.logEnergy(user.id, today, 5, "First entry");
    const result = await CalendarMutation.logEnergy(user.id, today, 8, "Updated entry");

    const entries = await prisma.energyLevel.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(result.energyLevel).toBe(8);
    expect(result.note).toBe("Updated entry");
  });

  it("stores date at midnight", async () => {
    const user = await createUser();
    const midDay = new Date("2025-06-15T14:30:00Z");

    await CalendarMutation.logEnergy(user.id, midDay, 6);

    const entry = await prisma.energyLevel.findFirst({ where: { userId: user.id } });
    expect(entry?.date.getHours()).toBe(0);
    expect(entry?.date.getMinutes()).toBe(0);
  });
});
