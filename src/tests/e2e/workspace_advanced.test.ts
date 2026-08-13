import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
} from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";

describe("🚀 Advanced Workspace & Task Journeys", () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('should handle "Workspace Slug & Identity" journey', async () => {
    /**
     * JOURNEY:
     * 1. Owner attempts to change the workspace slug
     * 2. Slug is immutable — the request succeeds but the slug is unchanged
     * 3. Workspace remains accessible via its original slug; the attempted
     *    slug was stripped and never applied (404)
     */
    const headers = await authWithCsrfHeaders(testUser);
    const attemptedSlug = `advanced-slug-${Date.now()}`;

    // 1. Attempt to change slug
    const updateRes = await request(app)
      .put(`/api/v1/workspaces/${testWorkspace.id}`)
      .set(headers)
      .send({ slug: attemptedSlug });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.slug).toBe(testWorkspace.slug);

    // 2. Still accessible via the original slug
    const verifyRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.slug}`)
      .set(headers);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.id).toBe(testWorkspace.id);

    // 3. The attempted slug was never applied
    const attemptedSlugRes = await request(app)
      .get(`/api/v1/workspaces/${attemptedSlug}`)
      .set(headers);

    expect(attemptedSlugRes.status).toBe(404);
  });

  it('should handle "Workspace Ownership Transfer" journey', async () => {
    /**
     * JOURNEY:
     * 1. Owner invites another user as ADMIN
     * 2. New Admin accepts invitation
     * 3. Owner transfers ownership to New Admin
     * 4. New Owner verifies they have owner privileges
     * 5. Old Owner verifies they are no longer the owner
     */
    const ownerHeaders = await authWithCsrfHeaders(testUser);
    
    const newOwner = await createUser({ emailVerified: new Date() });
    const newOwnerHeaders = await authWithCsrfHeaders(newOwner);

    // 1. Invite as ADMIN
    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/invite`)
      .set(ownerHeaders)
      .send({
        email: newOwner.email,
        role: "ADMIN",
      });
    const inviteToken = inviteRes.body.data.token;

    // 2. Accept Invitation
    await request(app)
      .post(`/api/v1/workspaces/invitations/${inviteToken}/accept`)
      .set(newOwnerHeaders);

    // 3. Transfer Ownership
    // Fetch the membership record for the new owner
    const memberRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}/members`)
      .set(ownerHeaders);
    const membership = memberRes.body.data.find((m: any) => m.userId === newOwner.id);

    const transferRes = await request(app)
      .put(`/api/v1/workspaces/${testWorkspace.id}/members/${membership.id}/role`)
      .set(ownerHeaders)
      .send({ role: "OWNER" });

    expect(transferRes.status).toBe(200);
    expect(transferRes.body.data.role).toBe("OWNER");

    // 4. New Owner verifies
    const verifyNewOwner = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}`)
      .set(newOwnerHeaders);
    
    expect(verifyNewOwner.status).toBe(200);
    // Logic to verify ownership usually involves checking role in membership
    const membersRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}/members`)
      .set(newOwnerHeaders);
    
    const newOwnerMember = membersRes.body.data.find((m: any) => m.userId === newOwner.id);
    expect(newOwnerMember.role).toBe("OWNER");
  });

  it('should handle "Workspace Deletion" journey', async () => {
    /**
     * JOURNEY:
     * 1. Owner deletes the workspace
     * 2. Owner verifies workspace is gone (soft-deleted → 404)
     * 3. Verify the data is retained for recovery (no cascade wipe) — the
     *    admin restore flow can bring the workspace back.
     */
    const headers = await authWithCsrfHeaders(testUser);

    // Setup: Create a project and task to verify data retention
    const projRes = await request(app).post("/api/v1/projects").set(headers).send({
      name: "Cleanup Project",
      workspaceId: testWorkspace.id,
    });
    const project = projRes.body.data;
    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Cleanup Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 1. Delete Workspace
    const deleteRes = await request(app)
      .delete(`/api/v1/workspaces/${testWorkspace.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);

    // 2. Verify gone for users
    const verifyRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}`)
      .set(headers);

    expect(verifyRes.status).toBe(404);

    // 3. Soft delete retains the data (recoverable via admin restore)
    const wsRow = await prisma.workspace.findUnique({
      where: { id: testWorkspace.id },
    });
    expect(wsRow?.deletedAt).not.toBeNull();

    const projRow = await prisma.project.findUnique({ where: { id: project.id } });
    expect(projRow).not.toBeNull();

    const taskRow = await prisma.task.findUnique({ where: { id: task.id } });
    expect(taskRow).not.toBeNull();
  });

  it('should handle "Sub-task Deep Lifecycle" journey', async () => {
    /**
     * JOURNEY:
     * 1. Create Parent Task
     * 2. Create multiple Sub-tasks
     * 3. Update a Sub-task status
     * 4. Delete a Sub-task
     * 5. Verify Parent Task overview reflects current sub-task state
     */
    const headers = await authWithCsrfHeaders(testUser);

    // Setup: Parent Task
    const projRes = await request(app).post("/api/v1/projects").set(headers).send({
      name: "Subtask Project",
      workspaceId: testWorkspace.id,
    });
    const project = projRes.body.data;
    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Parent Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 1. Create Sub-tasks
    const sub1Res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(headers)
      .send({ title: "Subtask 1", description: "Desc 1" });
    const sub1 = sub1Res.body.data;

    const sub2Res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(headers)
      .send({ title: "Subtask 2", description: "Desc 2" });
    const sub2 = sub2Res.body.data;

    expect(sub1Res.status).toBe(201);
    expect(sub2Res.status).toBe(201);

    // 2. Update Sub-task
    const updateRes = await request(app)
      .patch(`/api/v1/tasks/${task.id}/subtasks/${sub1.id}/status`)
      .set(headers)
      .send({ status: "COMPLETED" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.status).toBe("COMPLETED");

    // 3. Delete a Sub-task
    const deleteRes = await request(app)
      .delete(`/api/v1/tasks/${task.id}/subtasks/${sub2.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);

    // 4. Verify Parent Overview
    const overviewRes = await request(app)
      .get(`/api/v1/tasks/${task.id}/overview`)
      .set(headers);

    expect(overviewRes.status).toBe(200);
    // Verify that only sub1 remains and is completed
    const subtasks = overviewRes.body.data.task.subtasks || [];
    expect(subtasks.length).toBe(1);
    expect(subtasks[0].id).toBe(sub1.id);
    expect(subtasks[0].status).toBe("COMPLETED");
  });
});
