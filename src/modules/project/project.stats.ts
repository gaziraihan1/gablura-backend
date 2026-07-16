import type { ProjectForStats, ProjectStats } from './project.types.js';

export function calculateProjectStats(project: ProjectForStats): ProjectStats {
  const now = new Date();

  let completedTasks  = 0;
  let inProgressTasks = 0;
  let overdueTasks    = 0;

  // Count assignees on completed tasks directly in a single pass —
  // avoids collecting into an intermediate array and then reducing.
  const assigneeCounts = new Map<string, number>();
  let topPerformerId: string | null = null;
  let topPerformerCount = 0;

  for (const task of project.tasks) {
    const isCompleted = task.status === 'COMPLETED';
    const isInProgress = task.status === 'IN_PROGRESS';
    const isOverdue   = !!task.dueDate && new Date(task.dueDate) < now && !isCompleted;

    if (isCompleted) {
      completedTasks++;
      for (const a of task.assignees) {
        const userId = a.user.id;
        const newCount = (assigneeCounts.get(userId) ?? 0) + 1;
        assigneeCounts.set(userId, newCount);
        if (newCount > topPerformerCount) {
          topPerformerCount = newCount;
          topPerformerId = userId;
        }
      }
    }
    if (isInProgress) {
      inProgressTasks++;
    }

    if (isOverdue) overdueTasks++;
  }

  const startDate  = project.startDate ?? project.createdAt;
  const projectDays = Math.ceil(
    (now.getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24),
  );

  const topPerformer = topPerformerId
    ? (project.members.find((m) => m.userId === topPerformerId)?.user ?? null)
    : null;

  return {
    totalTasks:    project._count.tasks,
    completedTasks,
    inProgressTasks,
    overdueTasks,
    totalMembers:  project._count.members,
    projectDays,
    topPerformer,
  };
}