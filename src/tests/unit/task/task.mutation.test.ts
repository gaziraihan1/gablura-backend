import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskMutation } from "../../../modules/task/task.mutation.js";
import { TaskAccess } from "../../../modules/task/task.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ProjectAccess } from "../../../modules/project/project.access.js";
import { 
  checkAndConsumePersonalQuota, 
  checkAndConsumeWorkspaceQuota, 
  rollbackPersonalQuota, 
  rollbackWorkspaceQuota 
} from "../../../modules/task/task.quota.service.js";
import { BadRequestError, ForbiddenError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    task: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      count: vi.fn(),
    },
    taskAssignee: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    taskLabel: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    comment: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/task/task.access.js", () => ({
  TaskAccess: {
    checkEditPermission: vi.fn(),
    assertDeletePermission: vi.fn(),
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectNotArchived: vi.fn(),
  },
}));

vi.mock("../../../modules/task/task.quota.service.js", () => ({
  checkAndConsumePersonalQuota: vi.fn(),
  checkAndConsumeWorkspaceQuota: vi.fn(),
  rollbackPersonalQuota: vi.fn(),
  rollbackWorkspaceQuota: vi.fn(),
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    AnalyticsCache: { invalidateWorkspace: vi.fn() },
    WorkspaceCache: { invalidateWorkspace: vi.fn() },
    CacheClient: { 
      ...actual.CacheClient,
      get: vi.fn(), 
      set: vi.fn() 
    },
  };
});

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
  })),
}));

describe("TaskMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask", () => {
    const mockInput = {
      title: "Test Task",
      createdById: "u1",
      projectId: "p1",
    };

    it("should create a task in a workspace project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task", workspaceId: "ws1" } as any);

      const result = await TaskMutation.createTask(mockInput);

      expect(result.id).toBe("t1");
      expect(prisma.task.create).toHaveBeenCalled();
      expect(checkAndConsumeWorkspaceQuota).toHaveBeenCalled();
    });

    it("should create a personal task if no project", async () => {
      const input = { ...mockInput, projectId: null };
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
      vi.mocked(checkAndConsumePersonalQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task" } as any);

      const result = await TaskMutation.createTask(input as any);

      expect(result.id).toBe("t1");
      expect(checkAndConsumePersonalQuota).toHaveBeenCalled();
    });

    it("should throw BadRequestError if title is missing", async () => {
      const input = { ...mockInput, title: "" };
      await expect(TaskMutation.createTask(input)).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if workspace quota exceeded", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: false, reason: "Limit reached" } as any);

      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow(BadRequestError);
    });

    it("should rollback quota if DB creation fails", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockRejectedValue(new Error("DB Error"));

      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow("DB Error");
      expect(rollbackWorkspaceQuota).toHaveBeenCalled();
    });
  });

  describe("updateTask", () => {
    it("should update task if user has permission", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({ canEdit: true });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        projectId: null,
        assignees: [],
      } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "Updated" } as any);

      const result = await TaskMutation.updateTask("t1", "u1", { title: "Updated" });

      expect(result.title).toBe("Updated");
      expect(prisma.task.update).toHaveBeenCalled();
    });

    it("should throw ForbiddenError if user cannot edit", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({ canEdit: false, reason: "No access" });

      await expect(TaskMutation.updateTask("t1", "u1", { title: "Updated" })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update status and set completedAt if status is COMPLETED", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({ canEdit: true });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        status: "TODO",
        projectId: null,
      } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "COMPLETED" } as any);

      const result = await TaskMutation.updateTaskStatus("t1", "u1", "COMPLETED");

      expect(result.status).toBe("COMPLETED");
      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }));
    });
  });

  describe("deleteTask", () => {
    it("should delete task if permission granted", async () => {
      vi.mocked(TaskAccess.assertDeletePermission).mockResolvedValue({ id: "t1", workspaceId: "ws1" } as any);
      vi.mocked(prisma.task.delete).mockResolvedValue({ id: "t1" } as any);

      const result = await TaskMutation.deleteTask("t1", "u1");

      expect(result.success).toBe(true);
      expect(prisma.task.delete).toHaveBeenCalled();
    });
  });
});
