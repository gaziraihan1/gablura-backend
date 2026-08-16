
import { prisma } from "../../lib/prisma.js";
import type { WellnessRecommendation } from "./calendar.types.js";
import { ForbiddenError } from "../../errors/AppError.js";

// ─── Burnout-factor explanation helpers ──────────────────────────────────────
// The burnout signal now records WHY a week was risky (energy logs + focus
// sessions). These helpers turn those factors into plain-language drivers so
// recommendations explain the cause, not just the verdict.

interface StrainFactors {
  lowEnergyDays?: number | null;
  focusOverloadDays?: number | null;
  avgEnergy?: number | null;
}

/** "2 low-energy days and 1 focus-overload day" — or "" when none. */
function listStrainFactors(signal: StrainFactors): string {
  const parts: string[] = [];
  if ((signal.lowEnergyDays ?? 0) > 0) {
    parts.push(`${signal.lowEnergyDays} low-energy day${signal.lowEnergyDays === 1 ? "" : "s"}`);
  }
  if ((signal.focusOverloadDays ?? 0) > 0) {
    parts.push(`${signal.focusOverloadDays} focus-overload day${signal.focusOverloadDays === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

/** Sentence explaining which strain factors drove a high-risk week. */
function strainExplanation(signal: StrainFactors): string {
  const factors = listStrainFactors(signal);
  if (factors) {
    return ` This was driven by ${factors} this week.`;
  }
  if (signal.avgEnergy !== null && signal.avgEnergy !== undefined && signal.avgEnergy <= 4) {
    return ` Your energy averaged ${signal.avgEnergy}/10 this week.`;
  }
  return "";
}

/** "low-energy days rose from 1 to 3" — the factors that worsened week-over-week. */
function changedStrainDrivers(current: StrainFactors, prev: StrainFactors): string {
  const parts: string[] = [];
  if ((current.lowEnergyDays ?? 0) > (prev.lowEnergyDays ?? 0)) {
    parts.push(`low-energy days rose from ${prev.lowEnergyDays ?? 0} to ${current.lowEnergyDays}`);
  }
  if ((current.focusOverloadDays ?? 0) > (prev.focusOverloadDays ?? 0)) {
    parts.push(`focus-overload days rose from ${prev.focusOverloadDays ?? 0} to ${current.focusOverloadDays}`);
  }
  return parts.length > 0 ? ` Drivers: ${parts.join(" and ")}.` : "";
}

export const WellnessService = {
  async generateRecommendations(userId: string): Promise<WellnessRecommendation[]> {
    try {
      // Only generate new recommendations if none were created in the last 24 hours
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentRecs = await prisma.wellnessRecommendation.count({
        where: { userId, createdAt: { gte: dayAgo } },
      });

      if (recentRecs > 0) {
        // Return existing non-dismissed recommendations
        return prisma.wellnessRecommendation.findMany({
          where: {
            userId,
            dismissed: false,
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: new Date() } },
            ],
          },
          orderBy: { priority: "desc" },
          take: 10,
        });
      }

      return await this._generate(userId);
    } catch (error) {
      console.error(`[WellnessService] Failed to generate recommendations for user ${userId}:`, error);
      return [];
    }
  },

  async _generate(userId: string): Promise<WellnessRecommendation[]> {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const [recentSignals, aggregates, recentEnergy, userCapacity, existingRecs, recentFocusSessions] = await Promise.all([
      prisma.burnoutSignal.findMany({
        where: { userId, weekStart: { gte: monthAgo } },
        orderBy: { weekStart: "desc" },
        take: 4,
      }),

      prisma.calendarDayAggregate.findMany({
        where: { userId, date: { gte: weekAgo } },
        orderBy: { date: "desc" },
      }),

      prisma.energyLevel.findMany({
        where: { userId, date: { gte: weekAgo } },
        orderBy: { date: "desc" },
      }),

      prisma.userCapacity.findUnique({ where: { userId } }),

      prisma.wellnessRecommendation.findMany({
        where: {
          userId,
          dismissed: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: now } },
          ],
        },
        orderBy: { priority: "desc" },
        take: 10,
      }),

      prisma.focusSession.count({
        where: { userId, startedAt: { gte: weekAgo }, completed: true },
      }),
    ]);

    const newRecs: {
      type: string;
      message: string;
      priority: number;
      expiresAt?: Date;
    }[] = [];

    // 1. Burnout risk recommendation
    if (recentSignals.length > 0) {
      const latest = recentSignals[0];
      if (latest.riskLevel === "HIGH" || latest.riskLevel === "CRITICAL") {
        newRecs.push({
          type: "BURNOUT_PREVENTION",
          message: latest.riskLevel === "CRITICAL"
            ? `Your burnout risk is critical. Consider taking a day off or reducing your workload significantly.${strainExplanation(latest)}`
            : `Your burnout risk is high. Try to lighten your schedule and prioritize rest.${strainExplanation(latest)}`,
          priority: 100,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        });
      }

      // Low energy despite a manageable load — fatigue that workload alone
      // can't explain is an early burnout sign worth surfacing explicitly.
      if ((latest.lowEnergyDays ?? 0) >= 2) {
        newRecs.push({
          type: "ENERGY_INSIGHT",
          message: `You logged low energy on ${latest.lowEnergyDays} days this week. Even if your task load feels manageable, chronic low energy is an early burnout sign — pace yourself and protect your rest.`,
          priority: 65,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        });
      }

      // Sustained deep-focus overload — 6h+ focus days compound risk even
      // when the task list looks reasonable.
      if ((latest.focusOverloadDays ?? 0) >= 2) {
        newRecs.push({
          type: "BREAK_REMINDER",
          message: `You had ${latest.focusOverloadDays} focus-overload days (6h+ of deep work) this week. Sustained deep focus without recovery raises burnout risk — schedule lighter focus days.`,
          priority: 68,
          expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        });
      }

      // Trend recommendation
      if (recentSignals.length >= 2) {
        const prev = recentSignals[1];
        const riskLevels = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
        const currentIdx = riskLevels.indexOf(latest.riskLevel as any);
        const prevIdx = riskLevels.indexOf(prev.riskLevel as any);

        if (currentIdx > prevIdx) {
          newRecs.push({
            type: "WORKLOAD_ALERT",
            message: `Your burnout risk has increased from ${prev.riskLevel} to ${latest.riskLevel} over the past week. Review your task load and consider delegating or rescheduling.${changedStrainDrivers(latest, prev)}`,
            priority: 90,
            expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          });
        }
      }
    }

    // 2. Overload recommendation
    const overloadedDays = aggregates.filter(a => a.overCapacity).length;
    if (overloadedDays >= 3) {
      newRecs.push({
        type: "WORKLOAD_ALERT",
        message: `You've had ${overloadedDays} overloaded days this week. Try to keep daily planned hours within your capacity.`,
        priority: 80,
        expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      });
    }

    // 3. Energy correlation recommendation
    if (recentEnergy.length >= 3 && aggregates.length > 0) {
      const avgEnergy = recentEnergy.reduce((s, e) => s + e.energyLevel, 0) / recentEnergy.length;
      const avgWorkload = aggregates.reduce((s, a) => s + a.workloadScore, 0) / aggregates.length;

      if (avgEnergy < 5 && avgWorkload > 1.0) {
        newRecs.push({
          type: "ENERGY_INSIGHT",
          message: "Your energy levels have been low while workload remains high. Consider breaking tasks into smaller chunks and taking more frequent breaks.",
          priority: 70,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        });
      }

      if (avgEnergy >= 7 && avgWorkload <= 0.8) {
        newRecs.push({
          type: "CAPACITY_TIP",
          message: "Your energy levels are high and workload is manageable — a great time to tackle those challenging tasks you've been postponing!",
          priority: 40,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        });
      }
    }

    // 4. Focus session recommendation
    if (recentFocusSessions === 0) {
      newRecs.push({
        type: "FOCUS_SUGGESTION",
        message: "You haven't logged any focus sessions this week. Try a 25-minute Pomodoro session to boost productivity.",
        priority: 60,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    } else if (recentFocusSessions < 3) {
      newRecs.push({
        type: "FOCUS_SUGGESTION",
        message: `Only ${recentFocusSessions} focus session${recentFocusSessions === 1 ? '' : 's'} this week. Aim for at least 3-5 sessions for consistent deep work.`,
        priority: 50,
        expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      });
    }

    // 5. Capacity/schedule recommendation
    if (userCapacity) {
      const avgPlanned = aggregates.length > 0
        ? aggregates.reduce((s, a) => s + a.plannedHours, 0) / aggregates.length
        : 0;

      if (avgPlanned > userCapacity.dailyCapacityHours * 1.2 && aggregates.length >= 3) {
        newRecs.push({
          type: "SCHEDULE_ADVICE",
          message: `You're consistently planning ${avgPlanned.toFixed(1)}h/day but your capacity is ${userCapacity.dailyCapacityHours}h/day. Consider adjusting your daily capacity or reducing task commitments.`,
          priority: 75,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        });
      }
    }

    // 6. Break reminder
    const consecutiveWorkDays = aggregates.filter(a => a.totalTasks > 0).length;
    if (consecutiveWorkDays >= 5) {
      newRecs.push({
        type: "BREAK_REMINDER",
        message: "You've had tasks scheduled for 5+ consecutive days. Remember to take at least one full rest day each week to prevent burnout.",
        priority: 55,
        expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      });
    }

    // Check for duplicates with existing recs
    const existingMessages = new Set(existingRecs.map(r => r.message));
    const uniqueNewRecs = newRecs.filter(r => !existingMessages.has(r.message));

    // Save new recommendations to DB
    if (uniqueNewRecs.length > 0) {
      await prisma.wellnessRecommendation.createMany({
        data: uniqueNewRecs.map(r => ({
          userId,
          type: r.type as any,
          message: r.message,
          priority: r.priority,
          expiresAt: r.expiresAt,
        })),
      });
    }

    // Return combined (existing + new) non-dismissed recommendations
    const allRecs = await prisma.wellnessRecommendation.findMany({
      where: {
        userId,
        dismissed: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: now } },
        ],
      },
      orderBy: { priority: "desc" },
      take: 10,
    });

    return allRecs;
  },

  async dismissRecommendation(recId: string, userId: string): Promise<void> {
    const rec = await prisma.wellnessRecommendation.findUnique({ where: { id: recId }, select: { userId: true } });
    if (!rec) return;
    if (rec.userId !== userId) throw new ForbiddenError("Cannot dismiss another user's recommendation");

    await prisma.wellnessRecommendation.update({
      where: { id: recId },
      data: { dismissed: true },
    });
  },

  /**
   * Dismiss every non-dismissed recommendation for a user.
   * Returns the number of recommendations dismissed.
   */
  async dismissAllRecommendations(userId: string): Promise<number> {
    const result = await prisma.wellnessRecommendation.updateMany({
      where: { userId, dismissed: false },
      data: { dismissed: true },
    });
    return result.count;
  },
};
