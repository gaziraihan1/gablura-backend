import { describe, it, expect } from "vitest";
import { calculateProjectStats } from "../../../modules/project/project.stats.js";
import type { ProjectForStats, ProjectStats } from "../../../modules/project/project.types.js";

function makeProject(overrides: Partial<ProjectForStats> = {}): ProjectForStats {
  const now = new Date();
  return {
    startDate: null,
    createdAt: now,
    _count: { tasks: 0, members: 0 },
    tasks: [],
    members: [],
    ...overrides,
  };
}

describe("calculateProjectStats", () => {
  it("should return zero stats for a project with no tasks", () => {
    const project = makeProject({ _count: { tasks: 0, members: 0 } });

    const result = calculateProjectStats(project);

    expect(result.totalTasks).toBe(0);
    expect(result.completedTasks).toBe(0);
    expect(result.inProgressTasks).toBe(0);
    expect(result.overdueTasks).toBe(0);
    expect(result.totalMembers).toBe(0);
    expect(result.topPerformer).toBeNull();
  });

  it("should count completed tasks", () => {
    const project = makeProject({
      _count: { tasks: 2, members: 1 },
      tasks: [
        { status: "COMPLETED", dueDate: null, assignees: [], } as any,
        { status: "COMPLETED", dueDate: null, assignees: [], } as any,
      ],
      members: [],
    });

    const result = calculateProjectStats(project);

    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(2);
  });

  it("should count in-progress tasks", () => {
    const project = makeProject({
      _count: { tasks: 3, members: 1 },
      tasks: [
        { status: "IN_PROGRESS", dueDate: null, assignees: [] } as any,
        { status: "IN_PROGRESS", dueDate: null, assignees: [] } as any,
        { status: "TODO", dueDate: null, assignees: [] } as any,
      ],
      members: [],
    });

    const result = calculateProjectStats(project);

    expect(result.inProgressTasks).toBe(2);
  });

  it("should count overdue tasks (past dueDate and not completed)", () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    const project = makeProject({
      _count: { tasks: 3, members: 1 },
      tasks: [
        { status: "TODO", dueDate: past, assignees: [] } as any,
        { status: "IN_PROGRESS", dueDate: past, assignees: [] } as any,
        { status: "TODO", dueDate: future, assignees: [] } as any,
      ],
      members: [],
    });

    const result = calculateProjectStats(project);

    expect(result.overdueTasks).toBe(2);
  });

  it("should not count completed tasks as overdue", () => {
    const past = new Date(Date.now() - 86400000);
    const project = makeProject({
      _count: { tasks: 1, members: 1 },
      tasks: [
        { status: "COMPLETED", dueDate: past, assignees: [] } as any,
      ],
      members: [],
    });

    const result = calculateProjectStats(project);

    expect(result.completedTasks).toBe(1);
    expect(result.overdueTasks).toBe(0);
  });

  it("should determine top performer by completed tasks", () => {
    const alice = { id: "u1", name: "Alice", email: "alice@test.com", image: null };
    const bob = { id: "u2", name: "Bob", email: "bob@test.com", image: null };
    const project = makeProject({
      _count: { tasks: 3, members: 3 },
      tasks: [
        { status: "COMPLETED", dueDate: null, assignees: [{ user: alice }, { user: bob }] } as any,
        { status: "COMPLETED", dueDate: null, assignees: [{ user: alice }] } as any,
        { status: "TODO", dueDate: null, assignees: [] } as any,
      ],
      members: [
        { userId: "u1", user: alice } as any,
        { userId: "u2", user: bob } as any,
      ],
    });

    const result = calculateProjectStats(project);

    expect(result.topPerformer).not.toBeNull();
    expect(result.topPerformer!.id).toBe("u1");
    expect(result.topPerformer!.name).toBe("Alice");
  });

  it("should use startDate if available, otherwise createdAt for projectDays", () => {
    const createdAt = new Date("2024-01-01");
    const startDate = new Date("2024-06-01");
    const project = makeProject({
      startDate,
      createdAt,
      _count: { tasks: 0, members: 0 },
    });

    const result = calculateProjectStats(project);

    // Should use startDate
    const expectedDays = Math.ceil(
      (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(result.projectDays).toBe(expectedDays);
  });

  it("should return null topPerformer when no tasks are completed", () => {
    const project = makeProject({
      _count: { tasks: 1, members: 1 },
      tasks: [
        { status: "TODO", dueDate: null, assignees: [] } as any,
      ],
      members: [{ userId: "u1", user: { id: "u1", name: "Alice", email: "a@a.com", image: null } } as any],
    });

    const result = calculateProjectStats(project);

    expect(result.topPerformer).toBeNull();
  });
});
