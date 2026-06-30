import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskQuery } from "../../../modules/task/task.query.js";
import { prisma } from "../../../lib/prisma.js";
import { TaskFilters } from "../../../modules/task/task.filters.js";
import { CacheClient } from "../../../lib/redis/cache.client.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
    workspace: {
      findMany: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
    },
    file: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/task/task.filters.js", () => ({
  TaskFilters: {
    buildProjectFilter: vi.fn(),
    buildPersonalTasksFilter: vi.fn(),
    buildWorkspaceTasksFilter: vi.fn(),
    applyAdditionalFilters: vi.fn((w) => w),
    applySearchFilter: vi.fn((w) => w),
    buildOrderBy: vi.fn(),
  },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    CacheClient: {
      ...actual.CacheClient,
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("TaskQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTasks", () => {
    it("should fetch tasks with project filter", async () => {
      const filters = { projectId: "p1" };
      vi.mocked(TaskFilters.buildProjectFilter).mockReturnValue({ projectId: "p1" });
      vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: "t1", title: "Task 1" }] as any);
      vi.mocked(prisma.task.count).mockResolvedValue(1);

      const result = await TaskQuery.getTasks(filters as any);

      expect(result.data).toHaveLength(1);
      expect(result.pagination.totalCount).toBe(1);
      expect(TaskFilters.buildProjectFilter).toHaveBeenCalledWith(filters);
    });

    it("should fetch personal tasks if no project/workspace", async () => {
      const filters = { userId: "u1" };
      vi.mocked(TaskFilters.buildPersonalTasksFilter).mockReturnValue({ createdById: "u1" });
      vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: "t1" }] as any);
      vi.mocked(prisma.task.count).mockResolvedValue(1);

      const result = await TaskQuery.getTasks(filters as any);

      expect(result.data).toHaveLength(1);
      expect(TaskFilters.buildPersonalTasksFilter).toHaveBeenCalledWith(filters);
    });
  });

  describe("getTaskById", () => {
    it("should return task if user has access", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1", title: "Task 1" } as any);

      const result = await TaskQuery.getTaskById("t1", "u1") as any;

      expect(result.id).toBe("t1");
    });

    it("should throw NotFoundError if task not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(TaskQuery.getTaskById("t1", "u1")).rejects.toThrow("Task");
    });
  });

  describe("getTaskOverview", () => {
    it("should return full overview with comments and attachments", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1", title: "Task 1" } as any);
      vi.mocked(prisma.comment.findMany).mockResolvedValue([{ id: "c1", content: "Comment 1" }] as any);
      vi.mocked(prisma.file.findMany).mockResolvedValue([{ id: "f1", name: "File 1" }] as any);

      const result = await TaskQuery.getTaskOverview("t1", "u1") as { task: Record<string, unknown>; comments: unknown[]; attachments: unknown[] };


      expect(result.task.id).toBe("t1");
      expect(result.comments ).toHaveLength(1);
      expect(result.attachments).toHaveLength(1);
    });

    it("should throw NotFoundError if task not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(TaskQuery.getTaskOverview("t1", "u1")).rejects.toThrow("Task");
    });
  });

  describe("getTaskStats", () => {
    it("should return stats from cache if available", async () => {
      const stats = { totalTasks: 10, completed: 5 };
      vi.mocked(CacheClient.get).mockResolvedValue(stats);

      const result = await TaskQuery.getTaskStats({ userId: "u1" });

      expect(result).toEqual(stats);
      expect(prisma.task.count).not.toHaveBeenCalled();
    });

    it("should calculate stats if cache miss", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(TaskFilters.buildPersonalTasksFilter).mockReturnValue({});
      vi.mocked(prisma.task.count).mockResolvedValue(10);
      vi.mocked(prisma.task.groupBy).mockResolvedValue([] as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 0n }] as any);

      const result = await TaskQuery.getTaskStats({ userId: "u1" });

      expect(result.totalTasks).toBe(10);
      expect(CacheClient.set).toHaveBeenCalled();
    });
  });

  describe("getTasksByIntent", () => {
    it("should fetch tasks filtered by intent", async () => {
      const params = { userId: "u1", intent: "EXECUTION" as const };
      vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: "t1", intent: "EXECUTION" }] as any);

      const result = await TaskQuery.getTasksByIntent(params);

      expect(result).toHaveLength(1);
      expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ intent: "EXECUTION" })
      }));
    });
  });
});
