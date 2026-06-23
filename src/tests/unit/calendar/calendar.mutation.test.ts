import { describe, it, expect } from "vitest";
import { prisma } from "../../../lib/prisma.js";
import { CalendarMutation } from "../../../modules/calendar/calendar.mutation.js";
import { createWorkspaceWithOwner } from "../../factories/index.js";

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
