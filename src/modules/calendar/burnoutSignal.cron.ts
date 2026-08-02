import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { CalendarInsightsService } from "./calendar.insights.js";

const BATCH_SIZE = 50;

/**
 * Batch pre-compute weekly burnout signals for every active user.
 * Burnout signals are normally created on-demand when a user views calendar
 * insights; this cron guarantees trends data exists for all users each week
 * without requiring them to visit the calendar first.
 */
async function runBurnoutSignalCron(): Promise<void> {
  const start = Date.now();
  console.log("Running burnout signal generation cron...");

  let page = 0;
  let processed = 0;

  while (true) {
    const users = await prisma.user.findMany({
      where: {
        emailVerified: { not: null },
        bannedAt: null,
      },
      select: { id: true },
      orderBy: { id: "asc" },
      skip: page * BATCH_SIZE,
      take: BATCH_SIZE,
    });

    if (users.length === 0) break;

    // calculateBurnoutRisk normalizes the date to the start of the week
    // internally, so passing "now" is correct.
    await Promise.allSettled(
      users.map((u) =>
        CalendarInsightsService.calculateBurnoutRisk(u.id, new Date()).catch(
          () => {},
        ),
      ),
    );

    processed += users.length;
    page++;
  }

  console.log(
    `  Computed burnout signals for ${processed} users in ${Date.now() - start}ms`,
  );
}

export function startBurnoutSignalCron(): void {
  cron.schedule("0 7 * * 1", async () => {
    try {
      await runBurnoutSignalCron();
    } catch (error) {
      console.error("Burnout signal cron failed:", error);
    }
  });
}

export function initBurnoutSignalCron(): void {
  startBurnoutSignalCron();
}
