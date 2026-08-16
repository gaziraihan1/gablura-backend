/**
 * modules/automation/automation.cron.ts
 *
 * Scheduled scan for `DUE_DATE_APPROACHING` automation rules. Unlike the
 * user-initiated triggers (STATUS_CHANGED / TASK_CREATED), a task "entering"
 * its due-date window has no request that fires an event — so a cron scans
 * the calendar instead.
 *
 * How it works:
 * - Every 6 hours it loads enabled DUE_DATE_APPROACHING rules.
 * - For each rule it finds tasks in scope (workspace + optional project)
 *   whose dueDate falls inside [now, now + daysBefore] and are not
 *   COMPLETED/CANCELLED.
 * - A Redis marker keyed by (rule, task, dueDate) with a TTL of
 *   `daysBefore + 1` days ensures each task fires once per approach window;
 *   rescheduling the due date produces a fresh marker, so the task fires
 *   again for the new date.
 * - Each event carries `ruleId`, so the worker only executes that exact rule
 *   (the cron already matched it against the due date).
 */
import cron from 'node-cron';
import { prisma } from '../../lib/prisma.js';
import { CacheClient } from '../../lib/redis/cache.client.js';
import { emitAutomationEvent } from './automation.events.js';

// Runs at 00:15, 06:15, 12:15 and 18:15 UTC — frequent enough that a task
// created today and due tomorrow is picked up the same day.
const DUE_DATE_SCAN_SCHEDULE = '15 */6 * * *';
const DEFAULT_DAYS_BEFORE = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface DueDateRule {
  id: string;
  workspaceId: string;
  projectId: string | null;
  createdById: string;
  triggerConfig: unknown;
}

export async function runDueDateApproachingScan(): Promise<number> {
  const rules = await prisma.automationRule.findMany({
    where: { enabled: true, triggerType: 'DUE_DATE_APPROACHING' },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      createdById: true,
      triggerConfig: true,
    },
  });

  if (rules.length === 0) return 0;

  const now = Date.now();
  let emitted = 0;

  for (const rule of rules) {
    const daysBefore =
      ((rule as DueDateRule).triggerConfig as { daysBefore?: number | null } | null)
        ?.daysBefore ?? DEFAULT_DAYS_BEFORE;
    const windowEnd = new Date(now + daysBefore * MS_PER_DAY);

    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: rule.workspaceId,
        ...(rule.projectId ? { projectId: rule.projectId } : {}),
        dueDate: { gte: new Date(now), lte: windowEnd },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true, projectId: true, dueDate: true },
    });

    for (const task of tasks) {
      if (!task.dueDate) continue;

      // Fire once per (rule, task, due date) — TTL covers the window so a
      // later scan in the same window does not re-fire.
      const markerKey = `automation:due:${rule.id}:${task.id}:${task.dueDate.toISOString()}`;
      const alreadyFired = await CacheClient.get<boolean>(markerKey);
      if (alreadyFired) continue;

      emitAutomationEvent({
        trigger: 'DUE_DATE_APPROACHING',
        taskId: task.id,
        actorId: rule.createdById,
        workspaceId: rule.workspaceId,
        projectId: task.projectId ?? rule.projectId ?? null,
        dueDate: task.dueDate.toISOString(),
        ruleId: rule.id,
      });
      emitted += 1;

      // TTL in seconds: keep the marker alive one day past the window so the
      // task cannot re-fire immediately after the due date passes.
      const ttlSeconds = (daysBefore + 1) * 24 * 60 * 60;
      await CacheClient.set(markerKey, true, ttlSeconds);
    }
  }

  return emitted;
}

export function initAutomationCrons() {
  cron.schedule(
    DUE_DATE_SCAN_SCHEDULE,
    async () => {
      try {
        const emitted = await runDueDateApproachingScan();
        if (emitted > 0) {
          console.log(`🕐 Automation due-date scan emitted ${emitted} event(s)`);
        }
      } catch (error) {
        console.error('❌ Automation due-date scan failed:', error);
      }
    },
    {
      timezone: process.env.TIMEZONE || 'UTC',
    },
  );

  console.log(`✅ Automation due-date scan cron scheduled (${DUE_DATE_SCAN_SCHEDULE})`);
}
