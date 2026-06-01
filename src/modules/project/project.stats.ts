import type { ProjectForStats, ProjectStats } from './project.types.js';

export function calculateProjectStats(project: ProjectForStats): ProjectStats {
  const now = new Date();

  let completedTasks  = 0;
  let inProgressTasks = 0;
  let overdueTasks    = 0;
  const completedAssignees: Array<{
    id: string; name: string | null; email: string; image: string | null;
  }> = [];

  for (const task of project.tasks) {
    const isCompleted = task.status === 'COMPLETED';
    const isInProgress = task.status === 'IN_PROGRESS';
    const isOverdue   = !!task.dueDate && new Date(task.dueDate) < now && !isCompleted;

    if (isCompleted) {
      completedTasks++;
      for (const a of task.assignees) {
        completedAssignees.push(a.user);
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

  const counts = completedAssignees.reduce<Record<string, number>>((acc, user) => {
    acc[user.id] = (acc[user.id] ?? 0) + 1;
    return acc;
  }, {});

  const topPerformerId = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)[0]?.[0];

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