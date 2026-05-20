// src/tests/integrations/task.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// CSRF rule (applies to ALL test files):
//   POST / PUT / PATCH / DELETE  →  await authWithCsrfHeaders(user)
//   GET / HEAD / OPTIONS         →  authHeaders(user)
//   Unauthenticated tests        →  no headers at all
//
// ENFORCE_CSRF_IN_TESTS=true tells validateCsrfToken to check
// global._testCsrfTokens (in-memory) instead of bypassing in dev mode.
// Set it in beforeEach, clean it up in afterAll.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createProject,
  createTask,
} from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";
import { WorkspaceRole, TaskStatus, Priority } from "@prisma/client";
import { CacheClient } from "../../lib/redis/cache.client.js";

vi.mock("../../modules/task/task.quota.service.js", () => ({
  checkAndConsumePersonalQuota: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: new Date(),
    limit: 100,
    usedToday: 1,
  }),
  checkAndConsumeWorkspaceQuota: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 299,
    resetAt: new Date(),
    limit: 300,
    usedToday: 1,
  }),
  rollbackPersonalQuota: vi.fn().mockResolvedValue(undefined),
  rollbackWorkspaceQuota: vi.fn().mockResolvedValue(undefined),
  personalLimits: vi.fn().mockReturnValue({ dailyLimit: 100 }),
  workspaceLimits: vi.fn().mockReturnValue({
    dailyWorkspaceTotal: 300,
    dailyPerMember: 100,
    perMinute: 5,
    isUnlimited: false,
  }),
  getPersonalQuotaUsage: vi
    .fn()
    .mockResolvedValue({
      usedToday: 1,
      limit: 100,
      remaining: 99,
      resetAt: new Date(),
    }),
  getWorkspaceQuotaUsage: vi.fn().mockResolvedValue({
    workspaceUsedToday: 1,
    workspaceRemaining: 299,
    memberUsedToday: 1,
    memberRemaining: 99,
    isUnlimited: false,
    resetAt: new Date(),
    perMemberBreakdown: [],
  }),
}));

beforeEach(async () => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
  await CacheClient.deletePattern("stats:*").catch(() => {});
});

afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared factory helpers
// ─────────────────────────────────────────────────────────────────────────────
async function createWorkspaceTask(
  workspaceId: string,
  createdById: string,
  opts: {
    title?: string;
    status?: TaskStatus;
    priority?: Priority;
    projectId?: string;
  } = {},
) {
  const projectId =
    opts.projectId ??
    (
      await prisma.project.create({
        data: {
          name: `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          slug: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          workspaceId,
          createdById,
        },
      })
    ).id;

  return prisma.task.create({
    data: {
      title: opts.title ?? `Task-${Math.random().toString(36).slice(2, 8)}`,
      status: opts.status ?? TaskStatus.TODO,
      priority: opts.priority ?? Priority.MEDIUM,
      workspaceId,
      createdById,
      projectId,
    },
  });
}

async function createManyWorkspaceTasks(
  workspaceId: string,
  createdById: string,
  count: number,
  opts: { status?: TaskStatus; priority?: Priority } = {},
) {
  const project = await prisma.project.create({
    data: {
      name: `Bulk-${Date.now()}`,
      slug: `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId,
      createdById,
    },
  });
  await prisma.task.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      title: `Bulk Task ${i + 1}`,
      status: opts.status ?? TaskStatus.TODO,
      priority: opts.priority ?? Priority.MEDIUM,
      workspaceId,
      createdById,
      projectId: project.id,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/tasks — mutation, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/tasks", () => {
  it("201 — workspace member creates a task via project", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Implement login page",
        priority: Priority.HIGH,
        projectId: project.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Implement login page");
    expect(res.body.data.priority).toBe(Priority.HIGH);
    expect(res.body.data.projectId).toBe(project.id);
    expect(res.body.data.createdById).toBe(user.id);
  });

  it("201 — task inherits workspaceId from project", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Project linked task", projectId: project.id });

    expect(res.status).toBe(201);
    expect(res.body.data.projectId).toBe(project.id);
    expect(res.body.data.workspaceId).toBe(workspace.id);
  });

  it("201 — workspace MEMBER with project access can create task", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const project = await createProject(workspace.id, member.id);

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(member))
      .send({ title: "Member task", projectId: project.id });

    expect(res.status).toBe(201);
    expect(res.body.data.createdById).toBe(member.id);
  });

  it("201 — personal task (no projectId) uses personal quota", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Personal task with no project" });

    expect(res.status).toBe(201);
    expect(res.body.data.projectId).toBeNull();
    expect(res.body.data.workspaceId).toBeNull();
  });

  it("400 — missing title", async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(user))
      .send({ priority: Priority.HIGH });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400 — invalid priority value", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Bad priority",
        priority: "EXTREME",
        projectId: project.id,
      });

    expect(res.status).toBe(400);
  });

  it("403 — non-member cannot create task in workspace project", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/tasks")
      .set(await authWithCsrfHeaders(outsider))
      .send({ title: "Sneaky", projectId: project.id });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("401 — no token", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .send({ title: "No auth" });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/tasks — safe, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/tasks", () => {
  it("200 — OWNER sees all workspace tasks, paginated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createManyWorkspaceTasks(workspace.id, user.id, 7);

    const res = await request(app)
      .get(`/api/v1/tasks?workspaceId=${workspace.id}&pageSize=5&page=1`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.totalCount).toBe(7);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.pagination.hasNext).toBe(true);
  });

  it("200 — filters by status COMPLETED", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createManyWorkspaceTasks(workspace.id, user.id, 3, {
      status: TaskStatus.TODO,
    });
    await createManyWorkspaceTasks(workspace.id, user.id, 2, {
      status: TaskStatus.COMPLETED,
    });

    const res = await request(app)
      .get(
        `/api/v1/tasks?workspaceId=${workspace.id}&status=${TaskStatus.COMPLETED}`,
      )
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.pagination.totalCount).toBe(2);
    expect(
      res.body.data.every(
        (t: { status: string }) => t.status === TaskStatus.COMPLETED,
      ),
    ).toBe(true);
  });

  it("200 — filters by priority HIGH", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createManyWorkspaceTasks(workspace.id, user.id, 2, {
      priority: Priority.HIGH,
    });
    await createManyWorkspaceTasks(workspace.id, user.id, 3, {
      priority: Priority.LOW,
    });

    const res = await request(app)
      .get(
        `/api/v1/tasks?workspaceId=${workspace.id}&priority=${Priority.HIGH}`,
      )
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.pagination.totalCount).toBe(2);
  });

  it("200 — MEMBER sees only their involved tasks", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    await createManyWorkspaceTasks(workspace.id, owner.id, 3);
    const project = await createProject(workspace.id, member.id);
    await prisma.task.create({
      data: {
        title: "My task",
        workspaceId: workspace.id,
        createdById: member.id,
        projectId: project.id,
      },
    });

    const res = await request(app)
      .get(`/api/v1/tasks?workspaceId=${workspace.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it("200 — non-member gets 200 with empty array (no 403 guard on GET)", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/tasks?workspaceId=${workspace.id}`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.totalCount).toBe(0);
  });

  it("200 — personal tasks (no workspaceId)", async () => {
    const user = await createUser();
    await prisma.task.create({
      data: { title: "My personal task", createdById: user.id },
    });

    const res = await request(app).get("/api/v1/tasks").set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/tasks");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/tasks/:id — safe, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/tasks/:id", () => {
  it("200 — creator can get their own task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id, {
      title: "Specific Task",
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(task.id);
    expect(res.body.data.title).toBe("Specific Task");
    expect(res.body.data.timeTracking).toBeDefined();
  });

  it("200 — workspace member can get task", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createWorkspaceTask(workspace.id, owner.id);

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
  });

  it("404 — task does not exist", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/api/v1/tasks/clxxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app).get(`/api/v1/tasks/${task.id}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/tasks/:id — mutation, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/v1/tasks/:id", () => {
  it("200 — creator can update task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id, {
      title: "Old Title",
    });

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Updated Task", priority: Priority.HIGH });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Updated Task");
    expect(res.body.data.priority).toBe(Priority.HIGH);
    expect(res.body.data.timeTracking).toBeDefined();
  });

  it("200 — workspace ADMIN can update any task", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const task = await createWorkspaceTask(workspace.id, owner.id);

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(admin))
      .send({ title: "Admin Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Admin Updated");
  });

  it("500 — non-creator MEMBER cannot update (handleError maps permission error to 500)", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createWorkspaceTask(workspace.id, owner.id);

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(member))
      .send({ title: "Hijacked" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);

    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db?.title).not.toBe("Hijacked");
  });

  it("404 — task does not exist", async () => {
    const user = await createUser();

    const res = await request(app)
      .put("/api/v1/tasks/clxxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("400 — empty title rejected", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "" });

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .send({ title: "No auth" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/tasks/:id/status — mutation, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/v1/tasks/:id/status", () => {
  it("200 — creator updates task status", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id, {
      status: TaskStatus.TODO,
    });

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: TaskStatus.IN_PROGRESS });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(TaskStatus.IN_PROGRESS);
    expect(res.body.data.timeTracking).toBeDefined();
  });

  it("200 — completing task sets completedAt", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id, {
      status: TaskStatus.IN_PROGRESS,
    });

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: TaskStatus.COMPLETED });

    expect(res.status).toBe(200);
    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db?.completedAt).not.toBeNull();
  });

  it("200 — IN_REVIEW status", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: TaskStatus.IN_REVIEW });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(TaskStatus.IN_REVIEW);
  });

  it("500 — MEMBER cannot update status (same handleError mapping as PUT)", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createWorkspaceTask(workspace.id, owner.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(member))
      .send({ status: TaskStatus.COMPLETED });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);

    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db?.status).not.toBe(TaskStatus.COMPLETED);
  });

  it("400 — missing status", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it("400 — invalid status value", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: "FLYING" });

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .send({ status: TaskStatus.COMPLETED });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/tasks/:id — mutation, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/tasks/:id", () => {
  it("200 — creator can delete task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .delete(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db).toBeNull();
  });

  it("200 — workspace OWNER can delete any task", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createWorkspaceTask(workspace.id, member.id);

    const res = await request(app)
      .delete(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(owner));

    expect(res.status).toBe(200);
    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db).toBeNull();
  });

  it("403 — non-creator MEMBER cannot delete task", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createWorkspaceTask(workspace.id, owner.id);

    const res = await request(app)
      .delete(`/api/v1/tasks/${task.id}`)
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    const db = await prisma.task.findUnique({ where: { id: task.id } });
    expect(db).not.toBeNull();
  });

  it("404 — task does not exist", async () => {
    const user = await createUser();

    const res = await request(app)
      .delete("/api/v1/tasks/clxxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app).delete(`/api/v1/tasks/${task.id}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/tasks/stats — safe, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/tasks/stats", () => {
  it("200 — workspace stats", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createManyWorkspaceTasks(workspace.id, user.id, 3, {
      status: TaskStatus.TODO,
    });
    await createManyWorkspaceTasks(workspace.id, user.id, 2, {
      status: TaskStatus.IN_PROGRESS,
    });
    await createManyWorkspaceTasks(workspace.id, user.id, 1, {
      status: TaskStatus.COMPLETED,
    });

    const res = await request(app)
      .get(`/api/v1/tasks/stats?workspaceId=${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalTasks).toBe(6);
    expect(res.body.data.inProgress).toBe(2);
    expect(res.body.data.completed).toBe(1);
    expect(res.body.data.byStatus).toBeDefined();
  });

  it("200 — personal stats", async () => {
    const user = await createUser();
    await prisma.task.createMany({
      data: [
        { title: "P1", createdById: user.id, status: TaskStatus.TODO },
        { title: "P2", createdById: user.id, status: TaskStatus.COMPLETED },
      ],
    });

    const res = await request(app)
      .get("/api/v1/tasks/stats")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.totalTasks).toBeGreaterThanOrEqual(2);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/tasks/stats");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/tasks/:taskId/subtasks — safe, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/tasks/:taskId/subtasks", () => {
  it("200 — returns subtasks for a task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const parent = await createWorkspaceTask(workspace.id, user.id, {
      title: "Parent",
    });

    await prisma.task.createMany({
      data: [
        {
          title: "Sub 1",
          createdById: user.id,
          workspaceId: workspace.id,
          parentId: parent.id,
          depth: 1,
          projectId: parent.projectId,
        },
        {
          title: "Sub 2",
          createdById: user.id,
          workspaceId: workspace.id,
          parentId: parent.id,
          depth: 1,
          projectId: parent.projectId,
        },
      ],
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${parent.id}/subtasks`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].parentId).toBe(parent.id);
    expect(res.body.data[0].timeTracking).toBeDefined();
  });

  it("200 — empty array when no subtasks", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}/subtasks`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app).get(`/api/v1/tasks/${task.id}/subtasks`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/tasks/:taskId/subtasks — mutation, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/tasks/:taskId/subtasks", () => {
  it("201 — creates a subtask under a parent task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const parent = await createWorkspaceTask(workspace.id, user.id, {
      title: "Parent Task",
    });

    const res = await request(app)
      .post(`/api/v1/tasks/${parent.id}/subtasks`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Do the thing", priority: Priority.HIGH });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Subtask created successfully");
    expect(res.body.data.title).toBe("Do the thing");
    expect(res.body.data.parentId).toBe(parent.id);
    expect(res.body.data.depth).toBe(1);
  });

  it("404 — cannot create subtask of a subtask (assertCanCreateSubtask rejects depth=1 parent)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const parent = await createWorkspaceTask(workspace.id, user.id);
    const subtask = await prisma.task.create({
      data: {
        title: "Subtask",
        createdById: user.id,
        workspaceId: workspace.id,
        parentId: parent.id,
        depth: 1,
        projectId: parent.projectId,
      },
    });

    const res = await request(app)
      .post(`/api/v1/tasks/${subtask.id}/subtasks`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Grandchild" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("400 — missing title", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it("404 — non-member cannot create subtask", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);
    const outsider = await createUser();

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(await authWithCsrfHeaders(outsider))
      .send({ title: "Sneaky subtask" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("401 — unauthenticated", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createWorkspaceTask(workspace.id, user.id);

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .send({ title: "No auth" });

    expect(res.status).toBe(401);
  });
});
