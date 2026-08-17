/**
 * Integration tests for the time entries API:
 *   create → list per task → update → delete, plus permission and
 *   validation guards.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { WorkspaceRole } from "@prisma/client";

import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  addMemberToWorkspace,
  assignUserToTask,
} from "../factories/index.js";
import { authWithCsrfHeaders, authHeaders } from "../helpers/auth.js";

describe("POST /api/v1/time-entries — create", () => {
  it("201 — creates an entry on an accessible task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .post("/api/v1/time-entries")
      .set(headers)
      .send({ taskId: task.id, duration: 45, category: "DEEP_WORK", billable: true, description: "Focused work" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.taskId).toBe(task.id);
    expect(res.body.data.userId).toBe(user.id);
    expect(res.body.data.duration).toBe(45);
    expect(res.body.data.category).toBe("DEEP_WORK");
    expect(res.body.data.billable).toBe(true);
  });

  it("400 — rejects invalid payload (zero duration)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .post("/api/v1/time-entries")
      .set(headers)
      .send({ taskId: task.id, duration: 0 });

    expect(res.status).toBe(400);
  });

  it("404 — rejects a task the user cannot access", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);
    const headers = await authWithCsrfHeaders(outsider);

    const res = await request(app)
      .post("/api/v1/time-entries")
      .set(headers)
      .send({ taskId: task.id, duration: 30 });

    expect(res.status).toBe(404);
  });

  it("401 — unauthenticated", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const task = await createTask(workspace.id, owner.id);

    const res = await request(app)
      .post("/api/v1/time-entries")
      .send({ taskId: task.id, duration: 30 });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/time-entries/task/:taskId — list per task", () => {
  it("200 — returns all entries on the task with author info", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 60, startedAt: new Date() } });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/time-entries/task/${task.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].user).toBeDefined();
  });

  it("404 — inaccessible task", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);
    const headers = authHeaders(outsider);

    const res = await request(app)
      .get(`/api/v1/time-entries/task/${task.id}`)
      .set(headers);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/time-entries/:id — update", () => {
  it("200 — owner updates their entry", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .patch(`/api/v1/time-entries/${entry.id}`)
      .set(headers)
      .send({ duration: 90, category: "MEETINGS" });

    expect(res.status).toBe(200);
    expect(res.body.data.duration).toBe(90);
    expect(res.body.data.category).toBe("MEETINGS");
  });

  it("403 — another member cannot update the entry", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });
    const headers = await authWithCsrfHeaders(member);

    const res = await request(app)
      .patch(`/api/v1/time-entries/${entry.id}`)
      .set(headers)
      .send({ duration: 90 });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/time-entries/:id — delete", () => {
  it("200 — owner deletes their entry", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const entry = await prisma.timeEntry.create({
      data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() },
    });
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .delete(`/api/v1/time-entries/${entry.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    const found = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(found).toBeNull();
  });

  it("404 — deleting a missing entry", async () => {
    const { user } = await createWorkspaceWithOwner();
    const headers = await authWithCsrfHeaders(user);

    const res = await request(app)
      .delete("/api/v1/time-entries/missing")
      .set(headers);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/time-entries/my — own entries", () => {
  it("200 — returns only the requesting user's entries with task info", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 60, startedAt: new Date() } });
    const headers = authHeaders(user);

    const res = await request(app)
      .get("/api/v1/time-entries/my")
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(user.id);
    expect(res.body.data[0].task.title).toBe(task.title);
  });
});

describe("GET /api/v1/time-entries/workspace/:workspaceId — workspace time log", () => {
  it("200 — member sees only their own entries on accessible tasks", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    const otherMember = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(otherMember.id, workspace.id, WorkspaceRole.MEMBER);
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });
    await assignUserToTask(task.id, member.id);

    // Both members logged time on the same task the requesting member can access.
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: otherMember.id, duration: 45, startedAt: new Date() } });
    const headers = authHeaders(member);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    // A normal member only sees their own time log, not other members'.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(member.id);
    expect(res.body.data[0].task.title).toBe(task.title);
    expect(res.body.data[0].user.id).toBe(member.id);
  });

  it("200 — member does not see entries on tasks they cannot access", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const otherWorkspace = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(otherWorkspace.workspace.id, otherWorkspace.user.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: otherWorkspace.user.id, duration: 30, startedAt: new Date() } });
    const headers = authHeaders(member);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("200 — admin sees every member's entries in the workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    const member = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, member.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: admin.id, duration: 15, startedAt: new Date() } });
    const headers = authHeaders(admin);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const userIds = res.body.data.map((e: { userId: string }) => e.userId);
    expect(userIds).toContain(member.id);
    expect(userIds).toContain(admin.id);
  });

  it("200 — owner sees every member's entries in the workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, member.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 60, startedAt: new Date() } });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const userIds = res.body.data.map((e: { userId: string }) => e.userId);
    expect(userIds).toContain(member.id);
    expect(userIds).toContain(user.id);
  });

  it("200 — guest sees only their own entries", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const guest = await createUser();
    await addMemberToWorkspace(guest.id, workspace.id, WorkspaceRole.GUEST);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, guest.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: guest.id, duration: 20, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 90, startedAt: new Date() } });
    const headers = authHeaders(guest);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(guest.id);
  });

  it("200 — admin filters the workspace time log to one member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    const memberA = await createUser();
    const memberB = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    await addMemberToWorkspace(memberA.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(memberB.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, memberA.id);
    await assignUserToTask(task.id, memberB.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: memberA.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: memberB.id, duration: 45, startedAt: new Date() } });
    const headers = authHeaders(admin);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}?memberUserId=${memberA.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(memberA.id);
  });

  it("200 — owner filters the workspace time log to one member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const memberA = await createUser();
    const memberB = await createUser();
    await addMemberToWorkspace(memberA.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(memberB.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, memberA.id);
    await assignUserToTask(task.id, memberB.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: memberA.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: memberB.id, duration: 45, startedAt: new Date() } });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}?memberUserId=${memberB.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(memberB.id);
  });

  it("200 — a member-supplied memberUserId is ignored (only their own entries)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    const otherMember = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(otherMember.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);
    await assignUserToTask(task.id, member.id);

    await prisma.timeEntry.create({ data: { taskId: task.id, userId: member.id, duration: 30, startedAt: new Date() } });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: otherMember.id, duration: 45, startedAt: new Date() } });
    const headers = authHeaders(member);

    // Even with a forged memberUserId of another member, a normal member only
    // sees their own entries — never someone else's.
    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}?memberUserId=${otherMember.id}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(member.id);
  });

  it("403 — a user outside the workspace cannot view the workspace time log", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();
    const headers = authHeaders(outsider);

    const res = await request(app)
      .get(`/api/v1/time-entries/workspace/${workspace.id}`)
      .set(headers);

    expect(res.status).toBe(403);
  });
});

describe("workspace time reports still work", () => {
  it("200 — analytics time summary includes member breakdown", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });
    await prisma.timeEntry.create({ data: { taskId: task.id, userId: user.id, duration: 120, startedAt: new Date() } });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/time/summary?days=7`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.totalHours).toBe(2);
    expect(res.body.data.memberBreakdown).toHaveLength(1);
    expect(res.body.data.memberBreakdown[0].userId).toBe(user.id);
    expect(res.body.data.memberBreakdown[0].hours).toBe(2);
    expect(res.body.data.projectBreakdown).toHaveLength(1);
    expect(res.body.data.projectBreakdown[0].projectName).toBe(project.name);
  });

  it("200 — workspace time report includes project/task/member/category rollups", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });
    await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        userId: user.id,
        duration: 120,
        category: "DEEP_WORK",
        billable: true,
        description: "Workspace report work",
        startedAt: new Date(),
      },
    });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/time/report?days=7`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalMinutes).toBe(120);
    expect(res.body.data.totalHours).toBe(2);
    expect(res.body.data.entryCount).toBe(1);
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.entries[0].taskTitle).toBe(task.title);
    expect(res.body.data.entries[0].projectName).toBe(project.name);
    expect(res.body.data.byProject).toHaveLength(1);
    expect(res.body.data.byProject[0].id).toBe(project.id);
    expect(res.body.data.byProject[0].minutes).toBe(120);
    expect(res.body.data.byTask).toHaveLength(1);
    expect(res.body.data.byTask[0].id).toBe(task.id);
    expect(res.body.data.byMember).toHaveLength(1);
    expect(res.body.data.byMember[0].id).toBe(user.id);
    expect(res.body.data.byCategory).toHaveLength(1);
    expect(res.body.data.byCategory[0].category).toBe("DEEP_WORK");
  });
});

describe("project time reports", () => {
  it("200 — report returns entries plus task/member/category rollups", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });
    await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        userId: user.id,
        duration: 120,
        category: "DEEP_WORK",
        billable: true,
        description: "Implement report",
        startedAt: new Date(),
      },
    });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/time/report?days=7`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalMinutes).toBe(120);
    expect(res.body.data.totalHours).toBe(2);
    expect(res.body.data.entryCount).toBe(1);
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.entries[0].taskTitle).toBe(task.title);
    expect(res.body.data.entries[0].userName).toBe(user.name);
    expect(res.body.data.byTask).toHaveLength(1);
    expect(res.body.data.byTask[0].id).toBe(task.id);
    expect(res.body.data.byTask[0].minutes).toBe(120);
    expect(res.body.data.byMember).toHaveLength(1);
    expect(res.body.data.byMember[0].id).toBe(user.id);
    expect(res.body.data.byCategory).toHaveLength(1);
    expect(res.body.data.byCategory[0].category).toBe("DEEP_WORK");
    expect(res.body.data.byCategory[0].hours).toBe(2);
  });

  it("200 — a plain workspace member can view the project report", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const headers = authHeaders(member);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/time/report?days=7`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.entryCount).toBe(0);
  });

  it("403 — a user outside the workspace cannot view the project report", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const owner = await createUser();
    const outsider = await createUser();
    const project = await createProject(workspace.id, owner.id);
    const headers = authHeaders(outsider);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/time/report?days=7`)
      .set(headers);

    expect(res.status).toBe(403);
  });

  it("200 — respects the days window", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, { projectId: project.id });
    // 30 days ago → outside a 7-day window
    await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        userId: user.id,
        duration: 60,
        startedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
    const headers = authHeaders(user);

    const res = await request(app)
      .get(`/api/v1/analytics/${workspace.id}/projects/${project.id}/time/report?days=7`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.totalMinutes).toBe(0);
    expect(res.body.data.entryCount).toBe(0);
    expect(res.body.data.entries).toHaveLength(0);
  });
});
