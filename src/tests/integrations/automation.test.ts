/**
 * Integration tests for the automation pipeline:
 *   API (create rule / change task status) → controller event emission
 *   → worker execution (processAutomationEvent).
 *
 * The test setup mocks BullMQ, so queue jobs are swallowed. To exercise the
 * real flow, the automation queue module is mocked here to CAPTURE emitted
 * events, which are then fed into `processAutomationEvent` — the exact
 * function the production worker runs for each dequeued job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { WorkspaceRole } from "@prisma/client";

// Capture events emitted by controllers. `emitAutomationEvent` imports this
// module statically, so the mock must be installed before app.js is imported.
const capturedEvents: any[] = [];
const mockAddAutomationEventJob = vi.hoisted(() => vi.fn());

vi.mock("../../queue/queues/automation.queue.js", () => ({
  addAutomationEventJob: (...args: any[]) => mockAddAutomationEventJob(...args),
}));

import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createTask,
  addMemberToWorkspace,
} from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";
import { processAutomationEvent } from "../../queue/workers/automation.worker.js";

/** Flush microtasks so fire-and-forget event emissions land in the capture array. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("automation rules — end-to-end", () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    mockAddAutomationEventJob.mockReset();
    mockAddAutomationEventJob.mockImplementation(async (event: any) => {
      capturedEvents.push(event);
    });
  });

  it("runs a STATUS_CHANGED rule and applies its actions when the task status changes via the API", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, {
      projectId: project.id,
      status: "TODO",
      priority: "LOW",
    });
    const headers = await authWithCsrfHeaders(user);

    // Create the rule through the API: TODO → IN_PROGRESS bumps priority to HIGH.
    const ruleRes = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Prioritize in-progress tasks",
        triggerType: "STATUS_CHANGED",
        triggerConfig: { fromStatus: "TODO", toStatus: "IN_PROGRESS" },
        actions: [{ type: "SET_PRIORITY", config: { priority: "HIGH" } }],
      });

    expect(ruleRes.status).toBe(201);
    const ruleId = ruleRes.body.data.id;

    // Change the task status through the API — emits a STATUS_CHANGED event.
    const statusRes = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "IN_PROGRESS" });

    expect(statusRes.status).toBe(200);
    await flush();

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]).toMatchObject({
      trigger: "STATUS_CHANGED",
      taskId: task.id,
      workspaceId: workspace.id,
      projectId: project.id,
      fromStatus: "TODO",
      toStatus: "IN_PROGRESS",
    });

    // Feed the captured event to the worker — same function the real worker runs.
    await processAutomationEvent(capturedEvents[0]);

    const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(updatedTask?.priority).toBe("HIGH");

    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    expect(rule?.runCount).toBe(1);
    expect(rule?.lastRunAt).not.toBeNull();
  });

  it("skips rules whose trigger config does not match the transition", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, {
      projectId: project.id,
      status: "TODO",
      priority: "LOW",
    });
    const headers = await authWithCsrfHeaders(user);

    const ruleRes = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Only TODO → IN_PROGRESS",
        triggerType: "STATUS_CHANGED",
        triggerConfig: { fromStatus: "TODO", toStatus: "IN_PROGRESS" },
        actions: [{ type: "SET_PRIORITY", config: { priority: "URGENT" } }],
      });
    const ruleId = ruleRes.body.data.id;

    // BLOCKED is not the configured toStatus — the rule must not run.
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "BLOCKED" });
    await flush();

    expect(capturedEvents).toHaveLength(1);
    await processAutomationEvent(capturedEvents[0]);

    const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(updatedTask?.priority).toBe("LOW");

    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    expect(rule?.runCount).toBe(0);
  });

  it("fires TASK_CREATED rules when a task is created through the API", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const headers = await authWithCsrfHeaders(user);

    const ruleRes = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Self-assign new tasks",
        triggerType: "TASK_CREATED",
        triggerConfig: { projectId: null },
        actions: [{ type: "ASSIGN_USER", config: { role: "actor" } }],
      });
    expect(ruleRes.status).toBe(201);
    const ruleId = ruleRes.body.data.id;

    const taskRes = await request(app)
      .post("/api/v1/tasks")
      .set(headers)
      .send({ title: "Freshly created task", projectId: project.id });

    expect(taskRes.status).toBe(201);
    await flush();

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]).toMatchObject({
      trigger: "TASK_CREATED",
      actorId: user.id,
      workspaceId: workspace.id,
      projectId: project.id,
    });

    await processAutomationEvent(capturedEvents[0]);

    const taskId = taskRes.body.data.id;
    const assignee = await prisma.taskAssignee.findFirst({
      where: { taskId, userId: user.id },
    });
    expect(assignee).not.toBeNull();

    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    expect(rule?.runCount).toBe(1);
  });

  it("assigns the project owner via the ASSIGN_USER role action", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, {
      projectId: project.id,
      status: "TODO",
    });
    const headers = await authWithCsrfHeaders(user);

    await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Owner reviews completed work",
        triggerType: "STATUS_CHANGED",
        triggerConfig: { fromStatus: "TODO", toStatus: "IN_REVIEW" },
        actions: [{ type: "ASSIGN_USER", config: { role: "project-owner" } }],
      });
    await flush();

    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "IN_REVIEW" });
    await flush();

    await processAutomationEvent(capturedEvents[0]);

    const assignee = await prisma.taskAssignee.findFirst({
      where: { taskId: task.id, userId: project.createdById },
    });
    expect(assignee).not.toBeNull();
  });

  it("runs a rule on demand via POST /:id/test against a chosen task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);
    const task = await createTask(workspace.id, user.id, {
      projectId: project.id,
      status: "TODO",
      priority: "LOW",
    });
    const headers = await authWithCsrfHeaders(user);

    const ruleRes = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Run manually",
        triggerType: "STATUS_CHANGED",
        triggerConfig: { fromStatus: "TODO", toStatus: "IN_PROGRESS" },
        actions: [{ type: "SET_PRIORITY", config: { priority: "URGENT" } }],
      });
    const ruleId = ruleRes.body.data.id;

    // No event needed — the endpoint executes the rule synchronously.
    const runRes = await request(app)
      .post(`/api/v1/automations/${ruleId}/test`)
      .set(headers)
      .send({ taskId: task.id });

    expect(runRes.status).toBe(200);
    expect(runRes.body.success).toBe(true);

    const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(updatedTask?.priority).toBe("URGENT");

    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    expect(rule?.runCount).toBe(1);
  });

  it("rejects running a rule against a task outside the rule's workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { user: otherUser, workspace: otherWorkspace } = await createWorkspaceWithOwner();
    const task = await createTask(otherWorkspace.id, otherUser.id);
    const headers = await authWithCsrfHeaders(user);

    const ruleRes = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Scoped rule",
        triggerType: "STATUS_CHANGED",
        triggerConfig: {},
        actions: [{ type: "SET_PRIORITY", config: { priority: "HIGH" } }],
      });
    const ruleId = ruleRes.body.data.id;

    const runRes = await request(app)
      .post(`/api/v1/automations/${ruleId}/test`)
      .set(headers)
      .send({ taskId: task.id });

    expect(runRes.status).toBe(404);
    expect(runRes.body.code).toBe("NOT_FOUND");
  });

  it("rejects rule creation for non-admin workspace members (403)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const headers = await authWithCsrfHeaders(member);

    const res = await request(app)
      .post("/api/v1/automations")
      .set(headers)
      .send({
        workspaceId: workspace.id,
        name: "Member rule",
        triggerType: "STATUS_CHANGED",
        triggerConfig: {},
        actions: [{ type: "SET_PRIORITY", config: { priority: "HIGH" } }],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(capturedEvents).toHaveLength(0);
  });
});
