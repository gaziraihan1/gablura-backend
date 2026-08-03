import type { TaskForTimeTracking, TimeTracking, UpdateTaskInput } from './task.types.js';

export function getTimeStatus(task: TaskForTimeTracking, now = new Date()): TimeTracking {
  const createdAt = new Date(task.createdAt);
  const dueDate   = task.dueDate ? new Date(task.dueDate) : null;

  const hoursSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));

  let hoursUntilDue: number | null = null;
  let isOverdue   = false;
  let isDueToday  = false;

  if (dueDate) {
    const msUntilDue = dueDate.getTime() - now.getTime();
    hoursUntilDue    = Math.floor(msUntilDue / (1000 * 60 * 60));

    if (task.estimatedHours && task.actualHours) {
      isOverdue = task.actualHours > task.estimatedHours;
    } else if (task.estimatedHours) {
      isOverdue = hoursSinceCreation > task.estimatedHours;
    } else {
      isOverdue = now > dueDate;
    }

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    isDueToday = dueDate >= todayStart && dueDate <= todayEnd;
  }

  return {
    hoursSinceCreation,
    hoursUntilDue,
    isOverdue: task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && isOverdue,
    isDueToday,
    timeProgress: task.estimatedHours
      ? Math.min(100, Math.round((hoursSinceCreation / task.estimatedHours) * 100))
      : null,
  };
}

export function getTimeStatusBatch(tasks: TaskForTimeTracking[]): Map<string, TimeTracking> {
  const now    = new Date();
  const result = new Map<string, TimeTracking>();

  for (const task of tasks) {
    result.set((task as any).id, getTimeStatus(task, now));
  }

  return result;
}

// ─── Task update change tracking ─────────────────────────────────────────────────

/** Scalar snapshot of a task used to compute what actually changed on an update. */
export interface TaskUpdateSnapshot {
  title:           string | null;
  description:     string | null;
  priority:        string | null;
  status:          string | null;
  projectId:       string | null;
  dueDate:         Date | null;
  startDate:       Date | null;
  estimatedHours:  number | null;
  focusRequired:   boolean | null;
  focusLevel:      number | null;
  energyType:      string | null;
  distractionCost: number | null;
  intent:          string | null;
  assignees:       { userId: string }[];
  labels:          { labelId: string }[];
}

const toIsoDate = (value: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

const truncateValue = (value: unknown): unknown =>
  typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;

/**
 * Diff an update payload against the task's previous values and return the fields
 * that actually changed (used for activity logging, so members can see what an
 * update touched and who performed it). Returns an empty object when nothing
 * changed or the old snapshot is unavailable.
 */
export function computeTaskChanges(
  data: UpdateTaskInput,
  oldTask: TaskUpdateSnapshot | null,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (!oldTask) return changes;

  if (data.title !== undefined && data.title !== oldTask.title) changes.title = truncateValue(data.title);
  if (data.description !== undefined && data.description !== oldTask.description) changes.description = truncateValue(data.description);
  if (data.priority !== undefined && data.priority !== oldTask.priority) changes.priority = data.priority;
  if (data.status !== undefined && data.status !== oldTask.status) changes.status = data.status;
  if (data.projectId !== undefined && data.projectId !== oldTask.projectId) changes.project = data.projectId ?? null;

  if (data.dueDate !== undefined && toIsoDate(data.dueDate) !== toIsoDate(oldTask.dueDate)) {
    changes.dueDate = data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : null;
  }
  if (data.startDate !== undefined && toIsoDate(data.startDate) !== toIsoDate(oldTask.startDate)) {
    changes.startDate = data.startDate ? new Date(data.startDate).toISOString().slice(0, 10) : null;
  }

  if (data.estimatedHours !== undefined && data.estimatedHours !== oldTask.estimatedHours) changes.estimatedHours = data.estimatedHours;
  if (data.focusRequired !== undefined && data.focusRequired !== oldTask.focusRequired) changes.focusRequired = data.focusRequired;
  if (data.focusLevel !== undefined && data.focusLevel !== oldTask.focusLevel) changes.focusLevel = data.focusLevel;
  if (data.energyType !== undefined && data.energyType !== oldTask.energyType) changes.energyType = data.energyType;
  if (data.distractionCost !== undefined && data.distractionCost !== oldTask.distractionCost) changes.distractionCost = data.distractionCost;
  if (data.intent !== undefined && data.intent !== oldTask.intent) changes.intent = data.intent;

  if (data.assigneeIds !== undefined) {
    const oldIds = (oldTask.assignees ?? []).map((a) => a.userId).sort().join(',');
    const newIds = [...data.assigneeIds].sort().join(',');
    if (oldIds !== newIds) changes.assignees = `assignees (${data.assigneeIds.length})`;
  }

  if (data.labelIds !== undefined) {
    const oldIds = (oldTask.labels ?? []).map((l) => l.labelId).sort().join(',');
    const newIds = [...data.labelIds].sort().join(',');
    if (oldIds !== newIds) changes.labels = `labels (${data.labelIds.length})`;
  }

  return changes;
}