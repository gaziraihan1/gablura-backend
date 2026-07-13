
import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { WellnessService } from "./wellness.service.js";

const BATCH_SIZE = 50;

async function runWellnessCron(): Promise<void> {
  const start = Date.now();
  console.log("Running wellness recommendation cron...");

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

    await Promise.allSettled(
      users.map((u) =>
        WellnessService.generateRecommendations(u.id).catch(() => {}),
      ),
    );

    processed += users.length;
    page++;
  }

  console.log(`  Generated recommendations for ${processed} users in ${Date.now() - start}ms`);
}

export function startWellnessCron(): void {
  cron.schedule("0 6 * * *", async () => {
    try {
      await runWellnessCron();
    } catch (error) {
      console.error("Wellness recommendation cron failed:", error);
    }
  });
}

export function initWellnessCrons(): void {
  startWellnessCron();
}
