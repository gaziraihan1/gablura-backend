import { describe, it, expect, vi } from "vitest";
import { prisma } from "../../../lib/prisma.js";
import { WellnessService } from "../../../modules/calendar/wellness.service.js";
import { CalendarMutation } from "../../../modules/calendar/calendar.mutation.js";
import { createUser } from "../../factories/index.js";

describe("WellnessService.dismissRecommendation", () => {
  it("dismisses own recommendation", async () => {
    const user = await createUser();

    const rec = await prisma.wellnessRecommendation.create({
      data: {
        userId: user.id,
        type: "BREAK_REMINDER",
        message: "Take a break",
        priority: 50,
      },
    });

    await WellnessService.dismissRecommendation(rec.id, user.id);

    const updated = await prisma.wellnessRecommendation.findUnique({ where: { id: rec.id } });
    expect(updated?.dismissed).toBe(true);
  });

  it("does not dismiss another user's recommendation", async () => {
    const owner = await createUser();
    const other = await createUser();

    const rec = await prisma.wellnessRecommendation.create({
      data: {
        userId: owner.id,
        type: "FOCUS_SUGGESTION",
        message: "Focus more",
        priority: 50,
      },
    });

    await expect(
      WellnessService.dismissRecommendation(rec.id, other.id),
    ).rejects.toThrow("Cannot dismiss another user's recommendation");
  });

  it("does nothing for non-existent recommendation", async () => {
    const user = await createUser();
    await expect(
      WellnessService.dismissRecommendation("non-existent-id", user.id),
    ).resolves.not.toThrow();
  });
});

describe("WellnessService.dismissAllRecommendations", () => {
  it("dismisses all non-dismissed recommendations for the user", async () => {
    const user = await createUser();

    await prisma.wellnessRecommendation.createMany({
      data: [
        { userId: user.id, type: "BREAK_REMINDER", message: "Take a break", priority: 50 },
        { userId: user.id, type: "FOCUS_SUGGESTION", message: "Focus more", priority: 40 },
        { userId: user.id, type: "CAPACITY_TIP", message: "Already dismissed", priority: 30, dismissed: true },
      ],
    });

    const count = await WellnessService.dismissAllRecommendations(user.id);

    expect(count).toBe(2);

    const remaining = await prisma.wellnessRecommendation.findMany({
      where: { userId: user.id },
    });
    expect(remaining.every((r) => r.dismissed)).toBe(true);
  });

  it("only dismisses the calling user's recommendations", async () => {
    const owner = await createUser();
    const other = await createUser();

    await prisma.wellnessRecommendation.create({
      data: { userId: owner.id, type: "WORKLOAD_ALERT", message: "Heavy week", priority: 80 },
    });
    await prisma.wellnessRecommendation.create({
      data: { userId: other.id, type: "WORKLOAD_ALERT", message: "Other user", priority: 80 },
    });

    await WellnessService.dismissAllRecommendations(owner.id);

    const ownerRecs = await prisma.wellnessRecommendation.findMany({ where: { userId: owner.id } });
    const otherRecs = await prisma.wellnessRecommendation.findMany({ where: { userId: other.id } });

    expect(ownerRecs.every((r) => r.dismissed)).toBe(true);
    expect(otherRecs.every((r) => !r.dismissed)).toBe(true);
  });

  it("returns 0 when nothing to dismiss", async () => {
    const user = await createUser();
    const count = await WellnessService.dismissAllRecommendations(user.id);
    expect(count).toBe(0);
  });
});

describe("WellnessService.generateRecommendations", () => {
  it("generates focus suggestion for new users with no data", async () => {
    const user = await createUser();

    const result = await WellnessService.generateRecommendations(user.id);

    expect(Array.isArray(result)).toBe(true);
    expect(result.some((r: any) => r.type === "FOCUS_SUGGESTION")).toBe(true);
  });

  it("generates break reminder after 5+ consecutive work days", async () => {
    const user = await createUser();

    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      await prisma.calendarDayAggregate.create({
        data: {
          userId: user.id,
          date: d,
          totalTasks: 2,
          plannedHours: 6,
          overCapacity: false,
          workloadScore: 0.5,
        },
      });
    }

    const result = await WellnessService.generateRecommendations(user.id);

    const breakRecs = result.filter((r: any) => r.type === "BREAK_REMINDER");
    expect(breakRecs.length).toBeGreaterThanOrEqual(1);
  });

  it("does not regenerate within 24 hours", async () => {
    const user = await createUser();

    await prisma.wellnessRecommendation.create({
      data: {
        userId: user.id,
        type: "FOCUS_SUGGESTION",
        message: "Try a Pomodoro session",
        priority: 60,
        createdAt: new Date(),
      },
    });

    const result = await WellnessService.generateRecommendations(user.id);

    const hasExisting = result.some((r: any) => r.message === "Try a Pomodoro session");
    expect(hasExisting).toBe(true);
  });
});
