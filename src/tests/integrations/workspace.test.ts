import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { WorkspaceRole } from "@prisma/client";
import {
  addMemberToWorkspace,
  createUnverifiedUser,
  createUser,
  createWorkspaceWithOwner,
} from "../factories/index.js";
import {
  authHeaders,
  expiredAuthHeaders,
  invalidAuthHeaders,
} from "../helpers/auth.js";
import { prisma } from "../../lib/prisma.js";
import app from "../../app.js";

// Prevent real SMTP calls during invite tests
vi.mock("../../utils/email.js", () => ({
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/workspaces
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/workspaces", () => {
  it("201 — creates workspace and owner membership", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(authHeaders(user))
      .send({ name: "My Workspace" }); // slug is server-generated from name

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("My Workspace");
    // slug is derived server-side — just assert it's a non-empty string
    expect(typeof res.body.data.slug).toBe("string");
    expect(res.body.data.slug.length).toBeGreaterThan(0);

    // DB: workspace ownerId correct
    const ws = await prisma.workspace.findUnique({
      where: { id: res.body.data.id },
    });
    expect(ws?.ownerId).toBe(user.id);

    // DB: creator recorded as OWNER member
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId: res.body.data.id },
      },
    });
    expect(membership?.role).toBe(WorkspaceRole.OWNER);
  });

  it("201 — accepts optional fields (description, color, isPublic)", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(authHeaders(user))
      .send({
        name: "Full WS",
        description: "desc",
        color: "#FF5733",
        isPublic: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe("desc");
    expect(res.body.data.color).toBe("#FF5733");
    expect(res.body.data.isPublic).toBe(true);
  });

  it("401 — no Authorization header", async () => {
    const res = await request(app)
      .post("/api/v1/workspaces")
      .send({ name: "No Auth" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_TOKEN");
  });

  it("401 — expired token", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(expiredAuthHeaders(user))
      .send({ name: "Expired" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("401 — invalid token", async () => {
    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(invalidAuthHeaders())
      .send({ name: "Bad Token" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("403 — unverified email", async () => {
    const user = await createUnverifiedUser();
    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(authHeaders(user))
      .send({ name: "Unverified" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("422 — missing name", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(authHeaders(user))
      .send({ description: "no name field" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("422 — invalid color format (must be #RRGGBB)", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/api/v1/workspaces")
      .set(authHeaders(user))
      .send({ name: "Color WS", color: "red" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces", () => {
  it("200 — returns only workspaces the user belongs to", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createWorkspaceWithOwner(); // another user's workspace — must NOT appear

    const res = await request(app)
      .get("/api/v1/workspaces")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((w) => w.id);
    expect(ids).toContain(workspace.id);
    expect(ids).toHaveLength(1);
  });

  it("200 — returns multiple workspaces when user is a member of several", async () => {
    const { user, workspace: ws1 } = await createWorkspaceWithOwner();
    const { workspace: ws2 } = await createWorkspaceWithOwner();
    await addMemberToWorkspace(user.id, ws2.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get("/api/v1/workspaces")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((w) => w.id);
    expect(ids).toContain(ws1.id);
    expect(ids).toContain(ws2.id);
  });

  it("401 — no token", async () => {
    const res = await request(app).get("/api/v1/workspaces");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces/:slug
// Route accepts either a human-readable slug or an opaque ID.
// Non-members get 404 — the query-level membership filter hides private
// workspaces entirely (security by design, not a bug).
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces/:slug", () => {
  it("200 — owner can fetch workspace by slug", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(workspace.id);
    expect(res.body.data.slug).toBe(workspace.slug);
  });

  it("200 — owner can also fetch workspace by ID", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(workspace.id);
  });

  it("200 — MEMBER can view workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(workspace.id);
  });

  it("404 — non-member gets 404 (private workspace is not revealed)", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(404);
  });

  it("404 — non-existent slug", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/api/v1/workspaces/does-not-exist-xyz-999")
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).get(`/api/v1/workspaces/${workspace.slug}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces/:slug/overview
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces/:slug/overview", () => {
  it("200 — returns workspace + stats + projects for owner", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}/overview`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.workspace.id).toBe(workspace.id);
    expect(Array.isArray(res.body.data.projects)).toBe(true);

    const { stats } = res.body.data;
    expect(typeof stats.totalProjects).toBe("number");
    expect(typeof stats.totalMembers).toBe("number");
    expect(typeof stats.completionRate).toBe("number");
    expect(stats.completionRate).toBeGreaterThanOrEqual(0);
    expect(stats.completionRate).toBeLessThanOrEqual(100);
  });

  it("200 — MEMBER can access overview", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}/overview`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
  });

  it("404 — non-member gets 404 (workspace hidden)", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}/overview`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(404);
  });

  it("404 — non-existent workspace", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/api/v1/workspaces/no-such-workspace/overview")
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/workspaces/:id   (route uses PUT — not PATCH)
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/v1/workspaces/:id", () => {
  it("200 — OWNER can update workspace name", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(user))
      .send({ name: "Renamed Workspace" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Renamed Workspace");

    const updated = await prisma.workspace.findUnique({
      where: { id: workspace.id },
    });
    expect(updated?.name).toBe("Renamed Workspace");
  });

  it("200 — ADMIN can update workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(admin))
      .send({ name: "Admin Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Admin Renamed");
  });

  it("200 — partial update (description only, name unchanged)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(user))
      .send({ description: "New description" });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe("New description");
    expect(res.body.data.name).toBe(workspace.name);
  });

  it("403 — MEMBER cannot update workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(member))
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
  });

  it("403 — GUEST cannot update workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const guest = await createUser();
    await addMemberToWorkspace(guest.id, workspace.id, WorkspaceRole.GUEST);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(guest))
      .send({ name: "Guest Attempt" });

    expect(res.status).toBe(403);
  });

  it("403 — non-member cannot update workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(outsider))
      .send({ name: "Outsider" });

    expect(res.status).toBe(403);
  });

  it("422 — invalid color format", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(user))
      .send({ color: "not-a-hex" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: "No Token" });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/workspaces/:id
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/workspaces/:id", () => {
  it("200 — OWNER can delete workspace", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);

    const deleted = await prisma.workspace.findUnique({
      where: { id: workspace.id },
    });
    expect(deleted).toBeNull();
  });

  it("403 — ADMIN cannot delete workspace (only OWNER can)", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(admin));

    expect(res.status).toBe(403);

    const still = await prisma.workspace.findUnique({
      where: { id: workspace.id },
    });
    expect(still).not.toBeNull();
  });
  //   it('403 — suspended workspace cannot be accessed', async () => {
  //   const { user, workspace } = await createWorkspaceWithOwner();

  //   await prisma.workspace.update({
  //     where: { id: workspace.id },
  //     data: { deletedAt: new Date() },
  //   });

  //   const res = await request(app)
  //     .get(`/api/v1/workspaces/${workspace.slug}`)
  //     .set(authHeaders(user));

  //   expect(res.status).toBe(403);
  //   expect(res.body.code).toBe('WORKSPACE_SUSPENDED');
  // });

  it("403 — MEMBER cannot delete workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(member));

    expect(res.status).toBe(403);
  });

  it("403 — non-member cannot delete workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).delete(`/api/v1/workspaces/${workspace.id}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces/:id/members
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces/:id/members", () => {
  it("200 — OWNER sees all members", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const m1 = await createUser();
    const m2 = await createUser();
    await addMemberToWorkspace(m1.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(m2.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const memberUserIds = (res.body.data as { user: { id: string } }[]).map(
      (m) => m.user.id,
    );
    expect(memberUserIds).toContain(user.id);
    expect(memberUserIds).toContain(m1.id);
    expect(memberUserIds).toContain(m2.id);
    expect(res.body.data).toHaveLength(3);
  });

  it("200 — MEMBER can list members", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("403 — non-member is denied", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).get(
      `/api/v1/workspaces/${workspace.id}/members`,
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/workspaces/:id/invite
// NOTE: route is /invite (not /members); payload uses `email` (not `userId`)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/workspaces/:id/invite", () => {
  it("201 — OWNER can invite a user by email", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ email: invitee.email, role: "MEMBER" });

    expect(res.status).toBe(201);

    const invitation = await prisma.workspaceInvitation.findFirst({
      where: {
        workspaceId: workspace.id,
        email: invitee.email,
        status: "PENDING",
      },
    });
    expect(invitation).not.toBeNull();
    expect(invitation?.role).toBe(WorkspaceRole.MEMBER);
  });

  it("201 — ADMIN can invite a user", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    const invitee = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(admin))
      .send({ email: invitee.email, role: "GUEST" });

    expect(res.status).toBe(201);
  });

  it("409 — cannot invite someone who is already a member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ email: user.email, role: "MEMBER" }); // user is already OWNER

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("409 — cannot re-invite someone with a pending invitation", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ email: invitee.email, role: "MEMBER" });

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ email: invitee.email, role: "MEMBER" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("403 — MEMBER cannot invite others", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    const newUser = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(member))
      .send({ email: newUser.email, role: "MEMBER" });

    expect(res.status).toBe(403);
  });

  it("422 — missing email", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ role: "MEMBER" });

    expect(res.status).toBe(422);
  });

  it("422 — OWNER is not an invitable role", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(user))
      .send({ email: invitee.email, role: "OWNER" });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces/invitations/:token   (public — no auth required)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces/invitations/:token", () => {
  it("200 — returns invitation details without authentication", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(owner))
      .send({ email: invitee.email, role: "MEMBER" });

    const token: string = inviteRes.body.data.token;

    // No auth header — this endpoint is intentionally public
    const res = await request(app).get(
      `/api/v1/workspaces/invitations/${token}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe(token);
    expect(res.body.data.workspace.id).toBe(workspace.id);
    expect(res.body.data.email).toBe(invitee.email);
  });

  it("404 — non-existent token", async () => {
    const res = await request(app).get(
      "/api/v1/workspaces/invitations/totally-fake-token-xxxxxxx",
    );

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/workspaces/invitations/:token/accept
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/workspaces/invitations/:token/accept", () => {
  it("200 — invited user accepts and becomes a member", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(owner))
      .send({ email: invitee.email, role: "MEMBER" });

    const token: string = inviteRes.body.data.token;

    const res = await request(app)
      .post(`/api/v1/workspaces/invitations/${token}/accept`)
      .set(authHeaders(invitee));

    expect(res.status).toBe(200);

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: invitee.id, workspaceId: workspace.id },
    });
    expect(membership?.role).toBe(WorkspaceRole.MEMBER);

    const invitation = await prisma.workspaceInvitation.findFirst({
      where: { token },
    });
    expect(invitation?.status).toBe("ACCEPTED");
  });

  it("400 — wrong user account (email mismatch) cannot accept", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();
    const wrongUser = await createUser();

    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(owner))
      .send({ email: invitee.email, role: "MEMBER" });

    const token: string = inviteRes.body.data.token;

    const res = await request(app)
      .post(`/api/v1/workspaces/invitations/${token}/accept`)
      .set(authHeaders(wrongUser));

    expect(res.status).toBe(400);
  });

  it("400 — already-accepted invitation cannot be accepted again", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invite`)
      .set(authHeaders(owner))
      .send({ email: invitee.email, role: "MEMBER" });

    const token: string = inviteRes.body.data.token;

    await request(app)
      .post(`/api/v1/workspaces/invitations/${token}/accept`)
      .set(authHeaders(invitee));

    const res = await request(app)
      .post(`/api/v1/workspaces/invitations/${token}/accept`)
      .set(authHeaders(invitee));

    expect(res.status).toBe(400);
  });

  it("400 — invalid invitation token", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/workspaces/invitations/invalid-token/accept")
      .set(authHeaders(user));

    expect(res.status).toBe(400);
  });

  it("400 — expired invitation cannot be accepted", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const invitee = await createUser();

    const invitation = await prisma.workspaceInvitation.create({
      data: {
        email: invitee.email,
        role: "MEMBER",
        token: "expired-token",
        workspaceId: workspace.id,
        invitedById: owner.id,
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const res = await request(app)
      .post(`/api/v1/workspaces/invitations/${invitation.token}/accept`)
      .set(authHeaders(invitee));

    expect(res.status).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await request(app).post(
      "/api/v1/workspaces/invitations/any-token/accept",
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/workspaces/:id/members/:memberId
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/workspaces/:id/members/:memberId", () => {
  async function getMembershipId(
    userId: string,
    workspaceId: string,
  ): Promise<string> {
    const m = await prisma.workspaceMember.findFirstOrThrow({
      where: { userId, workspaceId },
    });
    return m.id;
  }

  it("200 — OWNER can remove a MEMBER", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const membershipId = await getMembershipId(member.id, workspace.id);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}/members/${membershipId}`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);

    const removed = await prisma.workspaceMember.findUnique({
      where: { id: membershipId },
    });
    expect(removed).toBeNull();
  });

  it("200 — ADMIN can remove a MEMBER", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    const member = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const membershipId = await getMembershipId(member.id, workspace.id);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}/members/${membershipId}`)
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
  });

  it("403 — MEMBER cannot remove another member", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const m1 = await createUser();
    const m2 = await createUser();
    await addMemberToWorkspace(m1.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(m2.id, workspace.id, WorkspaceRole.MEMBER);
    const m2MembershipId = await getMembershipId(m2.id, workspace.id);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}/members/${m2MembershipId}`)
      .set(authHeaders(m1));

    expect(res.status).toBe(403);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).delete(
      `/api/v1/workspaces/${workspace.id}/members/some-id`,
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/workspaces/:id/members/:memberId/role
// Only OWNER can change roles — ADMIN cannot
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/v1/workspaces/:id/members/:memberId/role", () => {
  async function getMembershipId(
    userId: string,
    workspaceId: string,
  ): Promise<string> {
    const m = await prisma.workspaceMember.findFirstOrThrow({
      where: { userId, workspaceId },
    });
    return m.id;
  }

  it("200 — OWNER can promote MEMBER to ADMIN", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const membershipId = await getMembershipId(member.id, workspace.id);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}/members/${membershipId}/role`)
      .set(authHeaders(user))
      .send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(WorkspaceRole.ADMIN);

    const updated = await prisma.workspaceMember.findUnique({
      where: { id: membershipId },
    });
    expect(updated?.role).toBe(WorkspaceRole.ADMIN);
  });

  it("200 — OWNER can demote ADMIN to MEMBER", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const membershipId = await getMembershipId(admin.id, workspace.id);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}/members/${membershipId}/role`)
      .set(authHeaders(user))
      .send({ role: "MEMBER" });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe(WorkspaceRole.MEMBER);
  });

  it("403 — ADMIN cannot change roles (only OWNER can)", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    const member = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const memberMembershipId = await getMembershipId(member.id, workspace.id);

    const res = await request(app)
      .put(
        `/api/v1/workspaces/${workspace.id}/members/${memberMembershipId}/role`,
      )
      .set(authHeaders(admin))
      .send({ role: "ADMIN" });

    expect(res.status).toBe(403);
  });

  it("403 — MEMBER cannot change roles", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const m1 = await createUser();
    const m2 = await createUser();
    await addMemberToWorkspace(m1.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(m2.id, workspace.id, WorkspaceRole.MEMBER);
    const m2Id = await getMembershipId(m2.id, workspace.id);

    const res = await request(app)
      .put(`/api/v1/workspaces/${workspace.id}/members/${m2Id}/role`)
      .set(authHeaders(m1))
      .send({ role: "ADMIN" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/workspaces/:id/stats
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/workspaces/:id/stats", () => {
  it("200 — member gets stats with correct shape", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/stats`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(typeof data.totalProjects).toBe("number");
    expect(typeof data.totalTasks).toBe("number");
    expect(typeof data.totalMembers).toBe("number");
    expect(typeof data.completedTasks).toBe("number");
    expect(typeof data.overdueTasks).toBe("number");
    expect(typeof data.completionRate).toBe("number");
    expect(data.completionRate).toBeGreaterThanOrEqual(0);
    expect(data.completionRate).toBeLessThanOrEqual(100);
  });

  it("403 — non-member is denied", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/stats`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).get(
      `/api/v1/workspaces/${workspace.id}/stats`,
    );
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/workspaces/:id/leave
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/workspaces/:id/leave", () => {
  it("200 — MEMBER can leave a workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/leave`)
      .set(authHeaders(member));

    expect(res.status).toBe(200);

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: member.id, workspaceId: workspace.id },
    });
    expect(membership).toBeNull();
  });

  it("400 — OWNER cannot leave (must transfer ownership first)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/leave`)
      .set(authHeaders(user));

    expect(res.status).toBe(400);
  });

  it("400 — non-member cannot leave", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/leave`)
      .set(authHeaders(outsider));

    expect(res.status).toBe(400);
  });

  it("401 — no token", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const res = await request(app).post(
      `/api/v1/workspaces/${workspace.id}/leave`,
    );
    expect(res.status).toBe(401);
  });
});
