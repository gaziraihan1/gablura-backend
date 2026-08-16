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

  it("burnout prevention names the strain factors that drove high risk", async () => {
    const user = await createUser();
    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        consecutiveHeavyDays: 2,
        avgDailyLoad: 1.3,
        riskLevel: "HIGH",
        lowEnergyDays: 3,
        focusOverloadDays: 2,
        avgEnergy: 3.5,
      },
    });

    const result = await WellnessService.generateRecommendations(user.id);

    const prevention = result.find((r: any) => r.type === "BURNOUT_PREVENTION");
    expect(prevention).toBeDefined();
    expect(prevention?.message).toContain("3 low-energy days");
    expect(prevention?.message).toContain("2 focus-overload days");
  });

  it("explains which strain factors worsened when risk increased", async () => {
    const user = await createUser();
    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        consecutiveHeavyDays: 0,
        avgDailyLoad: 0.5,
        riskLevel: "LOW",
        lowEnergyDays: 0,
        focusOverloadDays: 0,
      },
    });
    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        consecutiveHeavyDays: 3,
        avgDailyLoad: 1.4,
        riskLevel: "HIGH",
        lowEnergyDays: 2,
        focusOverloadDays: 0,
        avgEnergy: 4,
      },
    });

    const result = await WellnessService.generateRecommendations(user.id);

    const alert = result.find((r: any) => r.type === "WORKLOAD_ALERT" && r.message.includes("increased"));
    expect(alert).toBeDefined();
    expect(alert?.message).toContain("low-energy days rose from 0 to 2");
  });

  it("surfaces low energy even when the task load is manageable", async () => {
    const user = await createUser();
    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        consecutiveHeavyDays: 0,
        avgDailyLoad: 0.3,
        riskLevel: "LOW",
        lowEnergyDays: 3,
        focusOverloadDays: 0,
        avgEnergy: 3.8,
      },
    });

    const result = await WellnessService.generateRecommendations(user.id);

    const insight = result.find((r: any) => r.type === "ENERGY_INSIGHT" && r.message.includes("logged low energy on 3 days"));
    expect(insight).toBeDefined();
  });

  it("recommends recovery after focus-overload weeks", async () => {
    const user = await createUser();
    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        consecutiveHeavyDays: 2,
        avgDailyLoad: 1.2,
        riskLevel: "HIGH",
        lowEnergyDays: 0,
        focusOverloadDays: 2,
        avgEnergy: 7,
        focusMinutes: 1320,
      },
    });

    const result = await WellnessService.generateRecommendations(user.id);

    const rec = result.find((r: any) => r.type === "BREAK_REMINDER" && r.message.includes("focus-overload"));
    expect(rec).toBeDefined();
    expect(rec?.message).toContain("2 focus-overload days");
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
