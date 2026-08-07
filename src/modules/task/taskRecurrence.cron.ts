import cron from 'node-cron';
import { prisma } from '../../lib/prisma.js';
import { addInvalidateCacheJob } from '../../queue/index.js';

const BATCH_SIZE = 50;

export type RecurrencePattern = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

// ─── Next-due math ───────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function addMonthsClamped(d: Date, months: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), lastDay));
  return r;
}

/** Snap `d` forward to the next allowed weekday (JS: 0 = Sunday … 6 = Saturday). */
function nextWeekdayInSet(d: Date, days: number[]): Date {
  if (!days || days.length === 0) return d;
  const set = new Set(days);
  for (let i = 0; i < 7; i++) {
    const candidate = addDays(d, i);
    if (set.has(candidate.getDay())) return candidate;
  }
  return d;
}

export function computeNextDue(
  cursor: Date,
  pattern: string,
  interval?: number,
  days?: number[] | null,
): Date {
  const step = Math.max(1, interval || 1);
  switch (pattern) {
    case 'WEEKLY':
      return nextWeekdayInSet(addDays(cursor, step * 7), days ?? []);
    case 'MONTHLY':
      return addMonthsClamped(cursor, step);
    case 'CUSTOM':
      if (days && days.length > 0) return nextWeekdayInSet(addDays(cursor, step * 7), days);
      return addDays(cursor, step);
    case 'DAILY':
    default:
      return addDays(cursor, step);
  }
}

// ─── Scheduler run ───────────────────────────────────────────────────────────

export async function runTaskRecurrenceCron(): Promise<void> {
  const start = Date.now();
  let page = 0;
  let generated = 0;
  const workspaceIds = new Set<string>();
  const personalUserIds = new Set<string>();

  while (true) {
    const recurrences = await prisma.taskRecurrence.findMany({
      where: {
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      select: {
        id:             true,
        pattern:        true,
        interval:       true,
        days:           true,
        endsAt:         true,
        lastOccurredAt: true,
        taskId:         true,
        task: {
          select: {
            title:           true,
            description:     true,
            priority:        true,
            status:          true,
            projectId:       true,
            sectionId:       true,
            sprintId:        true,
            milestoneId:     true,
            workspaceId:     true,
            createdById:     true,
            estimatedHours:  true,
            focusRequired:   true,
            focusLevel:      true,
            energyType:      true,
            distractionCost: true,
            intent:          true,
            dueDate:         true,
            startDate:       true,
            labels:          { select: { labelId: true } },
            assignees:       { select: { userId: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
      skip:    page * BATCH_SIZE,
      take:    BATCH_SIZE,
    });

    if (recurrences.length === 0) break;

    for (const rec of recurrences) {
      const task = rec.task;
      const now = Date.now();
      // State cursor: lastOccurredAt, else the anchor task's future due date,
      // else "now" (legacy rows created before the state field existed).
      const cursor =
        rec.lastOccurredAt ??
        (task.dueDate && task.dueDate.getTime() > now ? task.dueDate : new Date());

      const nextDue = computeNextDue(cursor, rec.pattern, rec.interval, rec.days as number[] | null);
      if (nextDue.getTime() > now) continue; // not due yet

      try {
        // Idempotent by construction: the @@unique([recurrenceId, recurrenceDueDate])
        // constraint + skipDuplicates means re-running this cron (restart, overlap,
        // manual trigger) can never create a duplicate instance.
        await prisma.$transaction(async (tx) => {
          // Idempotency guard: createMany + skipDuplicates. The
          // @@unique([recurrenceId, recurrenceDueDate]) constraint means a second
          // run (restart, overlap, manual trigger) simply skips the insert.
          const { count } = await tx.task.createMany({
            data: [
              {
                title:             task.title,
                description:       task.description,
                status:            'TODO',
                priority:          task.priority,
                projectId:         task.projectId,
                sectionId:         task.sectionId,
                sprintId:          task.sprintId,
                milestoneId:       task.milestoneId,
                workspaceId:       task.workspaceId,
                createdById:       task.createdById,
                estimatedHours:    task.estimatedHours,
                focusRequired:     task.focusRequired,
                focusLevel:        task.focusLevel,
                energyType:        task.energyType,
                distractionCost:   task.distractionCost,
                intent:            task.intent,
                dueDate:           nextDue,
                startDate:         task.startDate,
                recurrenceId:      rec.id,
                recurrenceDueDate: nextDue,
              },
            ],
            skipDuplicates: true,
          });

          // createMany only writes scalars — attach labels/assignees to the
          // freshly created instance (unique on (recurrenceId, dueDate), so the
          // lookup is unambiguous).
          if (count > 0 && (task.labels.length > 0 || task.assignees.length > 0)) {
            const created = await tx.task.findFirst({
              where:  { recurrenceId: rec.id, recurrenceDueDate: nextDue },
              select: { id: true },
            });
            if (created) {
              if (task.labels.length > 0) {
                await tx.taskLabel.createMany({
                  data: task.labels.map((l) => ({ taskId: created.id, labelId: l.labelId })),
                  skipDuplicates: true,
                });
              }
              if (task.assignees.length > 0) {
                await tx.taskAssignee.createMany({
                  data: task.assignees.map((a) => ({ taskId: created.id, userId: a.userId })),
                  skipDuplicates: true,
                });
              }
            }
          }

          await tx.taskRecurrence.update({
            where: { id: rec.id },
            data:  { lastOccurredAt: nextDue },
          });
        });
        generated += 1;
        if (task.workspaceId) workspaceIds.add(task.workspaceId);
        else personalUserIds.add(task.createdById);
      } catch (error) {
        console.error(`Recurring task generation failed for recurrence ${rec.id}:`, error);
      }
    }

    page += 1;
  }

  for (const workspaceId of workspaceIds) {
    addInvalidateCacheJob({ type: 'analytics', workspaceId }).catch(() => {});
    addInvalidateCacheJob({ type: 'workspace', workspaceId }).catch(() => {});
    addInvalidateCacheJob({ type: 'task', workspaceId }).catch(() => {});
    addInvalidateCacheJob({ type: 'calendar', workspaceId }).catch(() => {});
  }
  for (const userId of personalUserIds) {
    addInvalidateCacheJob({ type: 'task', userId }).catch(() => {});
    addInvalidateCacheJob({ type: 'calendar', userId }).catch(() => {});
  }

  console.log(`Recurring task cron: generated ${generated} instances in ${Date.now() - start}ms`);
}

export function startTaskRecurrenceCron(): void {
  cron.schedule('0 1 * * *', async () => {
    try {
      await runTaskRecurrenceCron();
    } catch (error) {
      console.error('Recurring task cron failed:', error);
    }
  });
}

export function initTaskRecurrenceCrons(): void {
  startTaskRecurrenceCron();
}
