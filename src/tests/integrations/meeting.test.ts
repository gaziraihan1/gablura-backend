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
  it("201 — owner creates a meeting", async () => {
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

  it("400 — PRIVATE meeting without attendees", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const startTime = new Date(Date.now() + 3600000);
    const endTime = new Date(startTime.getTime() + 3600000);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Private Sync",
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        visibility: MeetingVisibility.PRIVATE,
        attendeeIds: [],
      });

    expect(res.status).toBe(400);
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

  it("403 — MEMBER cannot create meeting", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(await authWithCsrfHeaders(member))
      .send({
        title: "Member meeting",
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      });

    expect(res.status).toBe(403);
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

    expect(res.status).toBe(200);
  });

  it("200 — MEMBER sees PUBLIC meetings and their PRIVATE meetings", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    // Public meeting
    await createMeeting(workspace.id, owner.id, {
      title: "Public Meeting",
      visibility: MeetingVisibility.PUBLIC,
    });

    // Private meeting they are NOT in
    await createMeeting(workspace.id, owner.id, {
      title: "Secret Meeting",
      visibility: MeetingVisibility.PRIVATE,
      attendeeIds: [owner.id],
    });

    // Private meeting they ARE in
    await createMeeting(workspace.id, owner.id, {
      title: "Member's Private Meeting",
      visibility: MeetingVisibility.PRIVATE,
      attendeeIds: [member.id],
    });

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.meetings).toHaveLength(2);
    const titles = res.body.data.meetings.map((m: any) => m.title);
    expect(titles).toContain("Public Meeting");
    expect(titles).toContain("Member's Private Meeting");
    expect(titles).not.toContain("Secret Meeting");
  });

  it("200 — ADMIN sees all meetings regardless of visibility", async () => {
    const { user: admin, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    await createMeeting(workspace.id, member.id, { // Wait, member can't create, use admin
      title: "Admin Created Private",
      visibility: MeetingVisibility.PRIVATE,
      attendeeIds: [member.id],
    });
    // Re-creating meeting since member can't create
    const meeting = await prisma.meeting.create({
      data: {
        title: "Secret Admin Meeting",
        visibility: MeetingVisibility.PRIVATE,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        workspaceId: workspace.id,
        createdById: admin.id,
        attendees: { create: [{ userId: member.id }] },
      },
    });

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.meetings.some((m: any) => m.id === meeting.id)).toBe(true);
  });

  it("200 — filter by status", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createMeeting(workspace.id, user.id, { title: "Scheduled", status: MeetingStatus.SCHEDULED });
    await createMeeting(workspace.id, user.id, { title: "Cancelled", status: MeetingStatus.CANCELLED });

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings?status=CANCELLED`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.meetings).toHaveLength(1);
    expect(res.body.data.meetings[0].title).toBe("Cancelled");
  });

  it("200 — filter by upcoming", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    
    // Past meeting
    await prisma.meeting.create({
      data: {
        title: "Past Meeting",
        startTime: new Date(Date.now() - 86400000),
        endTime: new Date(Date.now() - 82800000),
        visibility: MeetingVisibility.PUBLIC,
        workspaceId: workspace.id,
        createdById: user.id,
      }
    });

    // Future meeting
    await createMeeting(workspace.id, user.id, {
      title: "Future Meeting",
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 90000000),
    });

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings?upcoming=true`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.meetings).toHaveLength(1);
    expect(res.body.data.meetings[0].title).toBe("Future Meeting");
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

  it("403 — member cannot view PRIVATE meeting they aren't invited to", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await createMeeting(workspace.id, owner.id, {
      title: "Secret Meeting",
      visibility: MeetingVisibility.PRIVATE,
      attendeeIds: [owner.id],
    });

    const res = await request(app)
      .get(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(403);
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
    expect(res.body.data.title).toBe("Updated Title");
  });

  it("200 — ADMIN can update meeting created by someone else", async () => {
    const { user: admin, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    // Admin creates meeting, member can't create so admin creates it for them or just any meeting
    const meeting = await createMeeting(workspace.id, admin.id);

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(admin))
      .send({ title: "Admin Updated" });

    expect(res.status).toBe(200);
  });

  it("403 — MEMBER cannot update meeting created by someone else", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await createMeeting(workspace.id, owner.id);

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(member))
      .send({ title: "Sneaky Update" });

    expect(res.status).toBe(403);
  });

  it("400 — cannot update CANCELLED meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    // Cancel it first
    await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Updated after cancel" });

    expect(res.status).toBe(400);
  });

  it("400 — update with endTime before startTime", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ 
        startTime: new Date(Date.now() + 7200000).toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(res.status).toBe(400);
  });

  it("400 — update to PRIVATE without attendees", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id, { visibility: MeetingVisibility.PUBLIC });

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ 
        visibility: MeetingVisibility.PRIVATE,
        attendeeIds: [],
      });

    expect(res.status).toBe(400);
  });

  it("200 — update attendees list", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const attendee1 = await createUser();
    const attendee2 = await createUser();
    await addMemberToWorkspace(attendee1.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(attendee2.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await createMeeting(workspace.id, user.id, {
      visibility: MeetingVisibility.PRIVATE,
      attendeeIds: [attendee1.id],
    });

    const res = await request(app)
      .patch(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user))
      .send({ attendeeIds: [attendee2.id] });

    expect(res.status).toBe(200);

    const updatedMeeting = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      include: { attendees: true },
    });
    expect(updatedMeeting?.attendees).toHaveLength(1);
    expect(updatedMeeting?.attendees[0].userId).toBe(attendee2.id);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/v1/meetings/:workspaceId/meetings/:meetingId/cancel
// ─────────────────────────────────────────────────────────────
describe("POST /api/v1/meetings/:workspaceId/meetings/:meetingId/cancel", () => {
  it("200 — creator can cancel meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(MeetingStatus.CANCELLED);
  });

  it("200 — ADMIN can cancel meeting", async () => {
    const { user: admin, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await prisma.meeting.create({
      data: {
        title: "Meeting to cancel",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        visibility: MeetingVisibility.PUBLIC,
        workspaceId: workspace.id,
        createdById: member.id,
      },
    });

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
  });

  it("403 — MEMBER cannot cancel meeting created by someone else", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await createMeeting(workspace.id, owner.id);

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });

  it("400 — cannot cancel already cancelled meeting", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const meeting = await createMeeting(workspace.id, user.id);

    await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .post(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}/cancel`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(400);
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

  it("200 — ADMIN can delete meeting", async () => {
    const { user: admin, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await prisma.meeting.create({
      data: {
        title: "Meeting to delete",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        visibility: MeetingVisibility.PUBLIC,
        workspaceId: workspace.id,
        createdById: member.id,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
  });

  it("403 — MEMBER cannot delete meeting created by someone else", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const meeting = await createMeeting(workspace.id, owner.id);

    const res = await request(app)
      .delete(`/api/v1/meetings/${workspace.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// Workspace Isolation
// ─────────────────────────────────────────────────────────────
describe("Workspace Isolation", () => {
  it("403 — cannot access meeting from another workspace", async () => {
    const { user: user1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: user2, workspace: ws2 } = await createWorkspaceWithOwner();

    const meeting = await createMeeting(ws1.id, user1.id);

    const res = await request(app)
      .get(`/api/v1/meetings/${ws2.id}/meetings/${meeting.id}`)
      .set(authHeaders(user2));

    expect(res.status).toBe(403);
  });

  it("403 — cannot update meeting from another workspace", async () => {
    const { user: user1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { user: user2, workspace: ws2 } = await createWorkspaceWithOwner();

    const meeting = await createMeeting(ws1.id, user1.id);

    const res = await request(app)
      .patch(`/api/v1/meetings/${ws2.id}/meetings/${meeting.id}`)
      .set(await authWithCsrfHeaders(user2))
      .send({ title: "Sneaky Cross-Workspace Update" });

    expect(res.status).toBe(403);
  });
});
