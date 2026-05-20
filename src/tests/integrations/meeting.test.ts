import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createMeeting,
} from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";
import {
  WorkspaceRole,
  MeetingStatus,
  MeetingVisibility,
} from "@prisma/client";

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

vi.mock("../../modules/billing/billing.service.js", () => ({
  BillingService: {
    getWorkspacePlanLimits: vi.fn().mockResolvedValue({
      maxMeetingsPerMo: -1,
      maxMembersPerWs: -1,
      maxProjects: -1,
      maxFileSizeMb: 100,
      analyticsAccess: true,
      apiAccess: true,
    }),
    getUserWorkspaceCreationLimit: vi.fn().mockResolvedValue(-1),
  },
}));

// ─────────────────────────────────────────────────────────────
// POST /api/v1/meetings/:workspaceId/meetings
// ─────────────────────────────────────────────────────────────
describe("POST /api/v1/meetings/:workspaceId/meetings", () => {
  it("201 — member creates a meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const startTime = new Date(Date.now() + 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Sprint Planning",
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe("Sprint Planning");

    const meeting = await prisma.meeting.findUnique({
      where: { id: res.body.data.id },
    });
    expect(meeting?.createdById).toBe(user.id);
    expect(meeting?.status).toBe(MeetingStatus.SCHEDULED);
  });

  it("201 — creates PRIVATE meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const startTime = new Date(Date.now() + 3600000);
    const endTime = new Date(startTime.getTime() + 3600000);

    const attendee = await createUser();
    await addMemberToWorkspace(attendee.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Private Sync",
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        visibility: MeetingVisibility.PRIVATE,
        attendeeIds: [attendee.id],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.visibility).toBe(MeetingVisibility.PRIVATE);
  });

  it("400 — missing title", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(400);
  });

  it("400 — missing startTime", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "No time",
        endTime: new Date(Date.now() + 3600000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(400);
  });

  it("400 — endTime before startTime", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Invalid times",
        startTime: new Date(Date.now() + 7200000).toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(400);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .send({});

    expect(res.status).toBe(401);
  });

  it("403 — non-member cannot create meeting", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(outsider))
      .send({
        title: "Sneaky meeting",
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/v1/meetings/:workspaceId/meetings
// ─────────────────────────────────────────────────────────────
describe("GET /api/v1/meetings/:workspaceId/meetings", () => {
  it("200 — workspace member sees meetings", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(authHeaders(user));

    console.log("STATUS:", res.status);
    console.log("BODY:", JSON.stringify(res.body));

    expect(res.status).toBe(200);
  });

  it("403 — non-member cannot list meetings", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/v1/meetings/:workspaceId/meetings/:meetingId
// ─────────────────────────────────────────────────────────────
describe("GET /api/v1/meetings/:workspaceId/meetings/:meetingId", () => {
  it("200 — member can view meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
  });

  it("404 — non-existent meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(
        `/api/v1/meetings/${workspace.id}/meetings/nonexistentid000000000000`,
      )
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/meetings/:workspaceId/meetings/:meetingId
// ─────────────────────────────────────────────────────────────
describe("PATCH /api/v1/meetings/:workspaceId/meetings/:meetingId", () => {
  it("200 — creator can update meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Updated Title" });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/meetings/:workspaceId/meetings/:meetingId
// ─────────────────────────────────────────────────────────────
describe("DELETE /api/v1/meetings/:workspaceId/meetings/:meetingId", () => {
  it("200 — creator can delete meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .delete(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const deleted = await prisma.meeting.findUnique({
      where: { id: meeting.id },
    });
    expect(deleted).toBeNull();
  });
});
