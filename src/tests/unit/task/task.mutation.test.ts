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
      findUnique: vi.fn(),
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
  resolveWorkspacePlan: vi.fn().mockResolvedValue("FREE"),
  resolveUserPlan: vi.fn().mockResolvedValue("FREE"),
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
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true, remaining: 100 } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task", workspaceId: "ws1" } as any);

      const result = await TaskMutation.createTask(mockInput);

      expect(result.id).toBe("t1");
      expect(prisma.task.create).toHaveBeenCalled();
      expect(checkAndConsumeWorkspaceQuota).toHaveBeenCalled();
    });

    it("should create a personal task if no project", async () => {
      const input = { ...mockInput, projectId: null };
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
      vi.mocked(checkAndConsumePersonalQuota).mockResolvedValue({ allowed: true, remaining: 50 } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task" } as any);

      const result = await TaskMutation.createTask(input as any);

      expect(result.id).toBe("t1");
      expect(checkAndConsumePersonalQuota).toHaveBeenCalled();
    });

    it("should throw BadRequestError if title is missing or empty", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, title: " " })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if title exceeds 200 characters", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, title: "a".repeat(201) })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if focusLevel is out of range", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, focusLevel: 6 })).rejects.toThrow(BadRequestError);
      await expect(TaskMutation.createTask({ ...mockInput, focusLevel: 0 })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if distractionCost is negative", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, distractionCost: -1 })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if startDate is after dueDate", async () => {
      const input = { 
        ...mockInput, 
        startDate: new Date('2026-07-01'), 
        dueDate: new Date('2026-06-01') 
      };
      await expect(TaskMutation.createTask(input as any)).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if too many assignees", async () => {
      const input = { ...mockInput, assigneeIds: ['1', '2', '3', '4', '5', '6'] };
      await expect(TaskMutation.createTask(input as any)).rejects.toThrow(BadRequestError);
    });

    it("should throw ForbiddenError if user has no access to the project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow(ForbiddenError);
    });

    it("should compute HIGH priority if dueDate is within 24 hours and priority not provided", async () => {
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 12);
      
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      
      const input = { ...mockInput, dueDate: tomorrow, priority: undefined };
      
      await TaskMutation.createTask(input as any);
      
      expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ priority: 'HIGH' })
      }));
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

    it("should call onCreated callback and handle its errors", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task", workspaceId: "ws1" } as any);
      
      const onCreated = vi.fn().mockRejectedValue(new Error("Callback Fail"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await TaskMutation.createTask(mockInput, onCreated);
      
      expect(onCreated).toHaveBeenCalled();
      // Wait for promise to settle
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(consoleSpy).toHaveBeenCalledWith('Post-creation callback failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe("updateTask", () => {
    it("should update task if user has permission", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "Updated" } as any);

      const result = await TaskMutation.updateTask("t1", "u1", { title: "Updated" });

      expect(result.title).toBe("Updated");
      expect(prisma.task.update).toHaveBeenCalled();
    });

    it("should sync assignees correctly when provided", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1" } as any);

      const newAssignees = ["u2", "u3"];
      await TaskMutation.updateTask("t1", "u1", { assigneeIds: newAssignees } as any);

      expect(prisma.taskAssignee.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { taskId: "t1" },
      }));
      expect(prisma.taskAssignee.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: newAssignees.map(userId => ({ taskId: "t1", userId })),
      }));
    });

    it("should sync labels correctly when provided", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1" } as any);

      const newLabels = ["l1", "l2"];
      await TaskMutation.updateTask("t1", "u1", { labelIds: newLabels } as any);

      expect(prisma.taskLabel.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { taskId: "t1" },
      }));
      expect(prisma.taskLabel.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: newLabels.map(labelId => ({ taskId: "t1", labelId })),
      }));
    });

    it("should handle project transition (Project A -> Project B)", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: "p1", workspaceId: "ws1", status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.project.findUnique).mockResolvedValue({ workspaceId: "ws2" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", projectId: "p2" } as any);

      await TaskMutation.updateTask("t1", "u1", { projectId: "p2" } as any);

      expect(checkAndConsumeWorkspaceQuota).toHaveBeenCalled();
      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: "p2" }),
      }));
    });

    it("should throw ForbiddenError if user cannot edit", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({ canEdit: false, reason: "No access" });

      await expect(TaskMutation.updateTask("t1", "u1", { title: "Updated" })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update status and set completedAt if status is COMPLETED", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "COMPLETED" } as any);

      const result = await TaskMutation.updateTaskStatus("t1", "u1", "COMPLETED");

      expect(result.status).toBe("COMPLETED");
      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }));
    });
  });

  describe("addComment", () => {
    it("should create a comment and trigger callback", async () => {
      vi.mocked(prisma.comment.create).mockResolvedValue({ id: "c1", content: "New comment" } as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({ 
        id: "t1", 
        title: "Task 1", 
        project: { workspaceId: "ws1" } 
      } as any);
      
      const onCommentAdded = vi.fn().mockResolvedValue(undefined);
      const result = await TaskMutation.addComment("t1", "u1", "New comment", onCommentAdded);

      expect(result.id).toBe("c1");
      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: { taskId: "t1", userId: "u1", content: "New comment" },
      });
      expect(onCommentAdded).toHaveBeenCalledWith({
        taskId: "t1",
        taskTitle: "Task 1",
        workspaceId: "ws1",
      });
    });
  });
});
