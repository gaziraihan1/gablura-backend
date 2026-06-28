import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Priority, ProjectStatus, TaskStatus, WorkspaceRole } from "@prisma/client";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  addMemberToWorkspace,
  assignUserToTask,
  createActivity,
  createProject,
  createTask,
  createUser,
  createWorkspaceWithOwner,
} from "../factories/index.js";
import { authHeaders } from "../helpers/auth.js";

const BASE = "/api/v1/workspace-usage";

describe("WorkspaceUsage integration", () => {
  beforeEach(async () => {
    await prisma.file.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.taskAssignee.deleteMany();
    await prisma.task.deleteMany();
    await prisma.project.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("GET /api/v1/workspace-usage/:workspaceId/usage", () => {
    it("200 — owner receives workspace usage analytics for a paid workspace", async () => {
      const { user: owner, workspace } = await createWorkspaceWithOwner(
        { name: "Owner", email: "owner-usage@test.dev" },
        { plan: "PRO" },
      );
      const member = await createUser({ name: "Member", email: "member-usage@test.dev" });
      await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

      await prisma.user.update({
        where: { id: owner.id },
        data: { lastLoginAt: new Date() },
      });

      const project = await createProject(workspace.id, owner.id, {
        name: "Usage Project",
        status: ProjectStatus.ACTIVE,
        priority: Priority.HIGH,
      });
      const task = await createTask(workspace.id, owner.id, {
        projectId: project.id,
        status: TaskStatus.TODO,
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      await assignUserToTask(task.id, member.id);
      await prisma.comment.create({
        data: { taskId: task.id, userId: member.id, content: "Looks good @owner" },
      });
      await prisma.file.create({
        data: {
          name: "usage-file.txt",
          originalName: "usage-file.txt",
          size: 2 * 1024 * 1024,
          mimeType: "text/plain",
          url: "https://cdn.test/usage-file.txt",
          workspaceId: workspace.id,
          projectId: project.id,
          uploadedById: member.id,
        },
      });
      await createActivity(owner.id, workspace.id, { taskId: task.id, entityId: task.id });
      await createActivity(member.id, workspace.id, { taskId: task.id, entityId: task.id });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/usage`)
        .set(authHeaders(owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        isAdmin: true,
        snapshot: {
          totalMembers: 2,
          totalTasks: 1,
          totalProjects: 1,
          storageUsedMB: 2,
        },
        planLimits: {
          currentPlan: "PRO",
          memberCount: 2,
          memberLimit: 50,
          storageUsedMB: 2,
          storageLimitMB: 5120,
          projectCount: 1,
          projectLimit: -1,
        },
        featureUsage: {
          tasksCreated: 1,
          commentsAdded: 1,
          filesUploaded: 1,
          mentionsUsed: 1,
        },
      });
      expect(res.body.data.projectActivity.mostActive[0]).toMatchObject({
        id: project.id,
        name: "Usage Project",
        taskCount: 1,
        commentCount: 1,
      });
      expect(res.body.data.resourceUsage.totalStorage).toMatchObject({
        usedMB: 2,
        totalMB: workspace.maxStorage,
      });
      expect(res.body.data.resourceUsage.storageByProject[0]).toMatchObject({
        projectId: project.id,
        projectName: "Usage Project",
        storageUsedMB: 2,
        fileCount: 1,
      });
      expect(res.body.data.userEngagement.collaborationIndex).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: member.id, commentsCount: 1, tasksAssigned: 1 }),
        ]),
      );
      expect(res.body.data.workspaceLoad.tasksPerUser).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: member.id, activeTasks: 1, capacityLevel: "OPTIMAL" }),
        ]),
      );
    });

    it("200 — regular member can access aggregate analytics but receives admin-only sections redacted", async () => {
      const { user: owner, workspace } = await createWorkspaceWithOwner({}, { plan: "BUSINESS" });
      const member = await createUser();
      await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
      await createProject(workspace.id, owner.id, { name: "Member Visible Project" });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/usage`)
        .set(authHeaders(member));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isAdmin).toBe(false);
      expect(res.body.data.snapshot.totalMembers).toBe(2);
      expect(res.body.data.userEngagement).toMatchObject({
        activeUsers: { online: 0, thisWeek: 0, thisMonth: 0 },
        inactiveUsers: [],
        collaborationIndex: [],
      });
      expect(res.body.data.workspaceLoad).toMatchObject({
        tasksPerUser: [],
        projectsNearingDeadlines: [],
      });
    });

    it("403 — free workspaces must upgrade to access usage analytics", async () => {
      const { user, workspace } = await createWorkspaceWithOwner({}, { plan: "FREE" });

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/usage`)
        .set(authHeaders(user));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: "Upgrade workspace plan to access usage analytics",
      });
    });

    it("403 — non-members cannot access workspace usage analytics", async () => {
      const { workspace } = await createWorkspaceWithOwner({}, { plan: "PRO" });
      const stranger = await createUser();

      const res = await request(app)
        .get(`${BASE}/${workspace.id}/usage`)
        .set(authHeaders(stranger));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        message: "You do not have access to this workspace",
      });
    });

    it("404 — missing workspace returns not found", async () => {
      const user = await createUser();

      const res = await request(app)
        .get(`${BASE}/missing-workspace-id/usage`)
        .set(authHeaders(user));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, message: "Workspace not found" });
    });

    it("401 — unauthenticated requests are rejected", async () => {
      const { workspace } = await createWorkspaceWithOwner({}, { plan: "PRO" });

      const res = await request(app).get(`${BASE}/${workspace.id}/usage`);

      expect(res.status).toBe(401);
    });
  });
});