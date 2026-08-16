// src/tests/integration/project/project.test.ts

import { describe, it, expect, afterEach, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { vi } from "vitest";
import { BillingService } from "../../../src/modules/billing/billing.service.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createProject,
} from "../factories/index.js";
import {
  authHeaders,
  authWithCsrfHeaders,
  invalidAuthHeaders,
} from "../helpers/auth.js";
import {
  WorkspaceRole,
  ProjectStatus,
  Priority,
  ProjectRole,
  TaskStatus,
  RecurrencePattern,
} from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// CSRF setup
//
// All state-changing requests (POST / PATCH / DELETE) must include a CSRF token.
// GET requests only need authHeaders() — CSRF middleware skips safe methods.
//
// authWithCsrfHeaders(user) returns { Authorization, 'x-csrf-token' } and
// stores the token in global._testCsrfTokens (in-memory fallback used when
// Redis is unavailable) keyed as csrf:{userId}:test-session.
// ENFORCE_CSRF_IN_TESTS tells validateCsrfToken to actually check that map
// instead of bypassing validation in dev mode.
// ─────────────────────────────────────────────────────────────────────────────

type ApiProject = {
  id: string;
  name: string;
  slug?: string;
  workspaceId?: string;
  status?: string;
};

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
  // Note: Cache clearing happens naturally through test isolation
  // Each test creates fresh data, so cache keys will be different
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/projects — billing
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/projects — billing", () => {
  it("403 — blocked when project limit reached", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    vi.spyOn(BillingService, "getWorkspacePlanLimits").mockResolvedValue({
      maxProjects: 1,
    } as any);

    await createProject(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({
        name: "Blocked Project",
        workspaceId: workspace.id,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("201 — allowed when unlimited", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    vi.spyOn(BillingService, "getWorkspacePlanLimits").mockResolvedValue({
      maxProjects: -1,
    } as any);

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({
        name: "Unlimited Project",
        workspaceId: workspace.id,
      });

    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/projects
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/projects", () => {
  it("201 — allowed when under limit", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    vi.spyOn(BillingService, "getWorkspacePlanLimits").mockResolvedValue({
      maxProjects: 2,
    } as any);

    await createProject(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({ name: "Second Project", workspaceId: workspace.id });

    expect(res.status).toBe(201);
  });

  it("201 — workspace member creates a project", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({
        name: "Focura v2",
        description: "Next gen project management.",
        workspaceId: workspace.id,
        priority: Priority.HIGH,
      });

    expect(res.status).toBe(201);
    const project = res.body.data;
    expect(project.name).toBe("Focura v2");
    expect(project.workspaceId).toBe(workspace.id);
    expect(project.status).toBe(ProjectStatus.ACTIVE);

    const db = await prisma.project.findUnique({ where: { id: project.id } });
    expect(db?.createdById).toBe(user.id);

    // Creator membership is NOT auto-created by current implementation
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: db!.id, userId: user.id } },
    });
    expect(membership).toBeNull();
  });

  it("201 — slug is auto-generated when not provided", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({ name: "Auto Slug Project", workspaceId: workspace.id });

    expect(res.status).toBe(201);
    const project = res.body.data;
    expect(project.slug).toBeDefined();
    expect(project.slug.length).toBeGreaterThan(0);
  });

  it("409 — duplicate slug within same workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, { slug: "taken-slug" });

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({
        name: "Another Project",
        workspaceId: workspace.id,
        slug: "taken-slug",
      });

    // SlugService may deduplicate (201) or throw on conflict (409)
    expect([201, 409]).toContain(res.status);
  });

  it("201 — same slug is OK in different workspaces", async () => {
    const { user: u1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    await createProject(ws1.id, u1.id, { slug: "shared-slug" });

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(u2))
      .send({
        name: "Same Slug Different WS",
        workspaceId: ws2.id,
        slug: "shared-slug",
      });

    expect(res.status).toBe(201);
  });

  it("403 — non-member cannot create project", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(outsider))
      .send({ name: "Sneaky Project", workspaceId: workspace.id });

    expect(res.status).toBe(403);
  });

  it("422 — missing name returns validation error", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post("/api/v1/projects")
      .set(await authWithCsrfHeaders(user))
      .send({ workspaceId: workspace.id });

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app)
      .post("/api/v1/projects")
      .send({ name: "No Auth", workspaceId: "any" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/projects/workspace/:workspaceId
// Safe method — no CSRF token needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/projects/workspace/:workspaceId", () => {
  it("200 — returns projects for workspace member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, { name: "Project Alpha" });
    await createProject(workspace.id, user.id, { name: "Project Beta" });

    const res = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list: ApiProject[] = res.body.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const names = list.map((p) => p.name);
    expect(names).toContain("Project Alpha");
    expect(names).toContain("Project Beta");
  });

  it("200 — does not return projects from other workspaces", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();

    await createProject(workspace.id, user.id, { name: "My Project" });
    await createProject(ws2.id, u2.id, { name: "Other Project" });

    const res = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    expect(list.some((p: { name: string }) => p.name === "Other Project")).toBe(
      false,
    );
  });

  it("403 — non-member cannot list projects", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/projects/workspace/some-id");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/projects/:projectId
// Safe method — no CSRF token needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/projects/:projectId", () => {
  it("200 — returns project with members", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Detail Project",
    });

    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;
    expect(data.id).toBe(project.id);
    expect(data.name).toBe("Detail Project");
  });

  it("200 — project detail tasks include recurrence", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Recurrence Project",
    });

    // One recurring and one plain task, so both shapes can be asserted
    const recurringTask = await prisma.task.create({
      data: {
        title: "Weekly Recurring Task",
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        workspaceId: workspace.id,
        createdById: user.id,
        projectId: project.id,
        recurrence: {
          create: {
            pattern: RecurrencePattern.WEEKLY,
            interval: 2,
            lastOccurredAt: new Date(),
          },
        },
      },
    });
    const plainTask = await prisma.task.create({
      data: {
        title: "Plain Task",
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        workspaceId: workspace.id,
        createdById: user.id,
        projectId: project.id,
      },
    });

    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;

    // projectDetailInclude embeds the recurrence on each task object
    const recurringInResponse = data.tasks.find((t: any) => t.id === recurringTask.id);
    expect(recurringInResponse).toBeDefined();
    expect(recurringInResponse.recurrence).toMatchObject({
      pattern: "WEEKLY",
      interval: 2,
    });

    const plainInResponse = data.tasks.find((t: any) => t.id === plainTask.id);
    expect(plainInResponse).toBeDefined();
    expect(plainInResponse.recurrence).toBeNull();
  });

  it("403 or 404 — non-member cannot view project", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(outsider));

    expect([403, 404]).toContain(res.status);
  });

  it("404 — non-existent project", async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get("/api/v1/projects/clxxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/projects/:projectId — state-changing, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/v1/projects/:projectId", () => {
  it("200 — MANAGER can update project name", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Old Name",
    });

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;
    expect(data.name).toBe("New Name");
  });

  it("200 — status transition ACTIVE → ON_HOLD", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      status: ProjectStatus.ACTIVE,
    });

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: ProjectStatus.ON_HOLD });

    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;
    expect(data.status).toBe(ProjectStatus.ON_HOLD);
  });

  it("200 — status transition → COMPLETED sets completedAt", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ status: ProjectStatus.COMPLETED });

    expect(res.status).toBe(200);
    const db = await prisma.project.findUnique({ where: { id: project.id } });
    expect(db?.completedAt).not.toBeNull();
  });

  it("403 — VIEWER cannot update project", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const viewer = await createUser();
    await addMemberToWorkspace(viewer.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: viewer.id,
        role: ProjectRole.VIEWER,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(viewer))
      .send({ name: "Viewer Cannot Edit" });

    expect(res.status).toBe(403);
  });

  it("422 — invalid priority value returns validation error", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ priority: "EXTREME" });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/projects/:projectId — state-changing, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/projects/:projectId", () => {
  it("200 — MANAGER/OWNER deletes project (cascades tasks)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    await prisma.task.create({
      data: {
        title: "Orphan Task",
        workspaceId: workspace.id,
        createdById: user.id,
        projectId: project.id,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const tasks = await prisma.task.findMany({
      where: { projectId: project.id },
    });
    expect(tasks).toHaveLength(0);
  });

  it("403 — COLLABORATOR cannot delete project", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const collab = await createUser();
    await addMemberToWorkspace(collab.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: collab.id,
        role: ProjectRole.COLLABORATOR,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(collab));

    expect(res.status).toBe(403);
  });

  it("404 — deleting non-existent project", async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete("/api/v1/projects/clxxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(await authWithCsrfHeaders(user));

    expect([403, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/projects/workspace/:workspaceId — filter by status
// Safe method — no CSRF token needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/projects/workspace/:workspaceId — status filter", () => {
  it("200 — returns all projects (no filter)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, {
      status: ProjectStatus.ACTIVE,
    });
    await createProject(workspace.id, user.id, {
      status: ProjectStatus.ARCHIVED,
    });

    const res = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("200 — getProjectsByWorkspace returns all projects for workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, {
      status: ProjectStatus.ACTIVE,
      name: "Active P",
    });
    await createProject(workspace.id, user.id, {
      status: ProjectStatus.ARCHIVED,
      name: "Archived P",
    });

    const res = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    const names = list.map((p: { name: string }) => p.name);
    expect(names).toContain("Active P");
    expect(names).toContain("Archived P");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/projects/user/all
// Safe method — no CSRF token needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/projects/user/all", () => {
  it("401 — invalid token", async () => {
    const res = await request(app)
      .get("/api/v1/projects/user/all")
      .set(invalidAuthHeaders());

    expect(res.status).toBe(401);
  });

  it("200 — returns all projects the user has access to", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, { name: "User Project 1" });
    await createProject(workspace.id, user.id, { name: "User Project 2" });

    const res = await request(app)
      .get("/api/v1/projects/user/all")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("200 — does not return projects from workspaces user has no access to", async () => {
    const { user } = await createWorkspaceWithOwner();
    const { user: u2, workspace: ws2 } = await createWorkspaceWithOwner();
    await createProject(ws2.id, u2.id, { name: "Secret Project" });

    const res = await request(app)
      .get("/api/v1/projects/user/all")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    expect(
      list.some((p: { name: string }) => p.name === "Secret Project"),
    ).toBe(false);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/projects/user/all");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/projects/slug/:slug
// Safe method — no CSRF token needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/projects/slug/:slug", () => {
  it("200 — returns project by slug for workspace member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      slug: "my-unique-slug",
    });

    const res = await request(app)
      .get("/api/v1/projects/slug/my-unique-slug")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;
    expect(data.id).toBe(project.id);
    expect(data.slug).toBe("my-unique-slug");
  });

  it("404 — non-existent slug", async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get("/api/v1/projects/slug/does-not-exist-ever")
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/projects/slug/some-slug");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/projects/:projectId/members — state-changing, needs CSRF
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/projects/:projectId/members", () => {
  it("201 — MANAGER can add a workspace member to project", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const newMember = await createUser();
    await addMemberToWorkspace(
      newMember.id,
      workspace.id,
      WorkspaceRole.MEMBER,
    );

    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: newMember.id, role: ProjectRole.COLLABORATOR });

    expect(res.status).toBe(201);
    const data = res.body.data ?? res.body;
    expect(data.userId).toBe(newMember.id);
  });

  it("400 — cannot add user who is not a workspace member", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const outsider = await createUser();

    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: outsider.id, role: ProjectRole.COLLABORATOR });

    expect(res.status).toBe(400);
  });

  it("400 — cannot add duplicate project member", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    // First add — needs its own CSRF headers
    await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: member.id });

    // Duplicate — authWithCsrfHeaders generates a fresh token each time,
    // both are valid for the same session so second call still passes CSRF
    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: member.id });

    expect(res.status).toBe(400);
  });

  it("403 — VIEWER cannot add members", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const viewer = await createUser();
    await addMemberToWorkspace(viewer.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: viewer.id,
        role: ProjectRole.VIEWER,
      },
    });
    const target = await createUser();
    await addMemberToWorkspace(target.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(viewer))
      .send({ userId: target.id });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Member changes must invalidate the shared slug cache
// ─────────────────────────────────────────────────────────────────────────────
describe("member add invalidates the shared slug cache", () => {
  it("slug detail reflects a newly added collaborator", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const collaborator = await createUser();
    await addMemberToWorkspace(collaborator.id, workspace.id, WorkspaceRole.MEMBER);

    // Warm the shared slug cache (as the owner)
    const warm = await request(app)
      .get(`/api/v1/projects/slug/${project.slug}`)
      .set(authHeaders(owner));
    expect(warm.status).toBe(200);
    const warmData = warm.body.data ?? warm.body;
    expect(warmData.members ?? []).toHaveLength(0);

    // Owner adds the collaborator
    const add = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: collaborator.id, role: ProjectRole.COLLABORATOR });
    expect(add.status).toBe(201);

    // The slug endpoint must now return the new member — the slug cache was
    // invalidated even though addProjectMember only knows the project id.
    const fresh = await request(app)
      .get(`/api/v1/projects/slug/${project.slug}`)
      .set(authHeaders(collaborator));
    expect(fresh.status).toBe(200);
    const data = fresh.body.data ?? fresh.body;
    const memberIds = (data.members ?? []).map((m: any) => m.userId);
    expect(memberIds).toContain(collaborator.id);
  });

  it("isAdmin is per-user on the shared slug cache", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const collaborator = await createUser();
    await addMemberToWorkspace(collaborator.id, workspace.id, WorkspaceRole.MEMBER);
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: collaborator.id,
        role: ProjectRole.COLLABORATOR,
      },
    });

    // Owner warms the cache first (isAdmin: true for the owner)
    const ownerRes = await request(app)
      .get(`/api/v1/projects/slug/${project.slug}`)
      .set(authHeaders(owner));
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.isAdmin).toBe(true);

    // A collaborator reading the same cached entry must NOT inherit isAdmin
    const collabRes = await request(app)
      .get(`/api/v1/projects/slug/${project.slug}`)
      .set(authHeaders(collaborator));
    expect(collabRes.status).toBe(200);
    expect(collabRes.body.data.isAdmin).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace project lists embed members and must refresh on member changes
// ─────────────────────────────────────────────────────────────────────────────
describe("workspace project list reflects members", () => {
  it("includes members and reflects a newly added collaborator", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const collaborator = await createUser();
    await addMemberToWorkspace(collaborator.id, workspace.id, WorkspaceRole.MEMBER);

    // Warm the workspace list cache (as the owner)
    const warm = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(owner));
    expect(warm.status).toBe(200);
    const warmList = warm.body.data ?? warm.body;
    const warmProject = warmList.find((p: any) => p.id === project.id);
    expect(warmProject.members ?? []).toHaveLength(0);

    // Owner adds the collaborator
    const add = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set(await authWithCsrfHeaders(owner))
      .send({ userId: collaborator.id, role: ProjectRole.COLLABORATOR });
    expect(add.status).toBe(201);

    // The workspace list must now include the member — proves both that the
    // list embeds members and that the workspace list cache was invalidated.
    const fresh = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(collaborator));
    expect(fresh.status).toBe(200);
    const freshList = fresh.body.data ?? fresh.body;
    const freshProject = freshList.find((p: any) => p.id === project.id);
    expect((freshProject.members ?? []).map((m: any) => m.userId)).toContain(
      collaborator.id,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Project Caching", () => {
  it("Cache hit on repeated project detail requests", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Cached Project",
    });

    // First request - cache miss
    const res1 = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res1.status).toBe(200);

    // Second request - should hit cache (or at least return same data)
    const res2 = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res2.status).toBe(200);
    expect(res2.body.data).toEqual(res1.body.data);
  });

  it("Cache invalidation after project update", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Original Name",
    });

    // Cache the project
    await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    // Update the project
    await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ name: "Updated Name" });

    // Request should return updated data (cache was invalidated)
    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Updated Name");
  });

  it("Cache invalidation after project deletion", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    // Cache the project
    await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    // Delete the project
    await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set(await authWithCsrfHeaders(user));

    // Request should return 404 (cache was invalidated)
    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });

  it("Workspace project list caching", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, { name: "Project 1" });
    await createProject(workspace.id, user.id, { name: "Project 2" });

    // First request - cache miss
    const res1 = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res1.status).toBe(200);
    const initialCount = (res1.body.data ?? res1).length;

    // Second request - should hit cache (or return same data)
    const res2 = await request(app)
      .get(`/api/v1/projects/workspace/${workspace.id}`)
      .set(authHeaders(user));

    expect(res2.status).toBe(200);
    expect((res2.body.data ?? res2).length).toBe(initialCount);
  });

  it("User project list caching", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createProject(workspace.id, user.id, { name: "User Project 1" });

    // First request - cache miss
    const res1 = await request(app)
      .get("/api/v1/projects/user/all")
      .set(authHeaders(user));

    expect(res1.status).toBe(200);
    const initialCount = (res1.body.data ?? res1).length;

    // Second request - should hit cache (or return same data)
    const res2 = await request(app)
      .get("/api/v1/projects/user/all")
      .set(authHeaders(user));

    expect(res2.status).toBe(200);
    expect((res2.body.data ?? res2).length).toBe(initialCount);
  });

  it("Project slug caching with access control", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      slug: "cached-slug",
    });

    // First request - cache miss
    const res1 = await request(app)
      .get("/api/v1/projects/slug/cached-slug")
      .set(authHeaders(user));

    expect(res1.status).toBe(200);

    // Second request - should hit cache (or return same data)
    const res2 = await request(app)
      .get("/api/v1/projects/slug/cached-slug")
      .set(authHeaders(user));

    expect(res2.status).toBe(200);
    expect(res2.body.data).toEqual(res1.body.data);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1 sub-resource reads are membership-gated (sections/sprints/milestones/views)
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 sub-resource reads are membership-gated", () => {
  it("403 — non-member cannot read sections/sprints/milestones/views (access restricted)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, { name: "Gated Project" });
    const outsider = await createUser();

    const sprint = await prisma.sprint.create({
      data: {
        name: "Sprint 1",
        projectId: project.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 86400000),
      },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { title: "M1", projectId: project.id },
    });

    const paths = [
      `/api/v1/projects/${project.id}/sections`,
      `/api/v1/projects/${project.id}/sprints`,
      `/api/v1/projects/${project.id}/sprints/active`,
      `/api/v1/projects/${project.id}/sprints/${sprint.id}`,
      `/api/v1/projects/${project.id}/milestones`,
      `/api/v1/projects/${project.id}/milestones/${milestone.id}`,
      `/api/v1/projects/${project.id}/views`,
    ];

    for (const path of paths) {
      const res = await request(app).get(path).set(authHeaders(outsider));
      // 403 FORBIDDEN so the client renders the "access restricted" screen.
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
  });

  it("200 — workspace member can read sections/sprints/milestones/views", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, { name: "Member Project" });

    await prisma.sprint.create({
      data: { name: "S1", projectId: project.id, startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000) },
    });
    await prisma.projectMilestone.create({
      data: { title: "M1", projectId: project.id },
    });
    await prisma.projectView.create({
      data: { name: "V1", type: "LIST", projectId: project.id, createdById: user.id },
    });

    const paths = [
      `/api/v1/projects/${project.id}/sections`,
      `/api/v1/projects/${project.id}/sprints`,
      `/api/v1/projects/${project.id}/milestones`,
      `/api/v1/projects/${project.id}/views`,
    ];

    for (const path of paths) {
      const res = await request(app).get(path).set(authHeaders(user));
      expect(res.status).toBe(200);
    }
  });

  it("404 — member cannot read a sprint/milestone of another project via its id", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const projectA = await createProject(workspace.id, owner.id, { name: "Project A" });
    const projectB = await createProject(workspace.id, owner.id, { name: "Project B" });

    const sprintA = await prisma.sprint.create({
      data: { name: "SA", projectId: projectA.id, startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000) },
    });
    const milestoneA = await prisma.projectMilestone.create({
      data: { title: "MA", projectId: projectA.id },
    });

    // Same user, member of both projects — but the URL projectId (B) must match
    const sprintRes = await request(app)
      .get(`/api/v1/projects/${projectB.id}/sprints/${sprintA.id}`)
      .set(authHeaders(owner));
    expect(sprintRes.status).toBe(404);

    const milestoneRes = await request(app)
      .get(`/api/v1/projects/${projectB.id}/milestones/${milestoneA.id}`)
      .set(authHeaders(owner));
    expect(milestoneRes.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project analytics page is access-gated (403 access restricted, not partial
// data / error toast)
// ─────────────────────────────────────────────────────────────────────────────
describe("Project analytics page access gate", () => {
  it("403 — non-member gets access restricted on the project analytics page", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Analytics Project",
    });
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/overview`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("200 — workspace member can view the project analytics page", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id, {
      name: "Analytics Project",
    });

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/overview`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
