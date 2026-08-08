import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspace,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
} from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders, generateTestToken } from "../helpers/auth.js";
import { getRedisClient } from "../../redis/redis.client.js";
import { WorkspaceRole } from "@prisma/client";

const BASE = "/api/v1/user";

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});

afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/user/profile
// Safe method — authHeaders only, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/user/profile", () => {
  it("200 — returns own profile wrapped in data.user, no password", async () => {
    const user = await createUser({
      name: "Test Person",
      email: "testme@focura.test",
    });

    const res = await request(app)
      .get(`${BASE}/profile`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.email).toBe("testme@focura.test");
    expect(res.body.data.user.name).toBe("Test Person");
    expect(res.body.data.user.password).toBeUndefined();
  });

  it("200 — response includes expected fields from controller select", async () => {
    const user = await createUser();

    const res = await request(app)
      .get(`${BASE}/profile`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const u = res.body.data.user;
    expect(u).toHaveProperty("id");
    expect(u).toHaveProperty("name");
    expect(u).toHaveProperty("email");
    expect(u).toHaveProperty("image");
    expect(u).toHaveProperty("bio");
    expect(u).toHaveProperty("timezone");
    expect(u).toHaveProperty("role");
    expect(u).toHaveProperty("createdAt");
    expect(u).toHaveProperty("updatedAt");
    expect(u).toHaveProperty("ownedWorkspaces");
    expect(u).not.toHaveProperty("password");
    expect(u).not.toHaveProperty("notifications");
  });

  it("200 — ownedWorkspaces includes workspaces the user owns", async () => {
    const user = await createUser();
    await createWorkspace(user.id, { name: "My Workspace" });

    const res = await request(app)
      .get(`${BASE}/profile`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const workspaces = res.body.data.user.ownedWorkspaces;
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThanOrEqual(1);
    expect(workspaces[0]).toHaveProperty("id");
    expect(workspaces[0]).toHaveProperty("name");
    expect(workspaces[0]).toHaveProperty("plan");
  });

  it("200 — ownedWorkspaces is empty when user owns no workspaces", async () => {
    const user = await createUser();

    const res = await request(app)
      .get(`${BASE}/profile`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.user.ownedWorkspaces).toHaveLength(0);
  });

  it("401 — unauthenticated request", async () => {
    const res = await request(app).get(`${BASE}/profile`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/user/profile — updateUserProfile
// State-changing — authWithCsrfHeaders required
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/v1/user/profile", () => {
  it("200 — updates name, response wrapped in data.user", async () => {
    const user = await createUser({ name: "Old Name" });

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Profile updated successfully");
    expect(res.body.data.user.name).toBe("New Name");

    const db = await prisma.user.findUnique({ where: { id: user.id } });
    expect(db?.name).toBe("New Name");
  });

  it("200 — updates bio", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ bio: "Full-stack dev building Focura." });

    expect(res.status).toBe(200);
    expect(res.body.data.user.bio).toBe("Full-stack dev building Focura.");

    const db = await prisma.user.findUnique({ where: { id: user.id } });
    expect(db?.bio).toBe("Full-stack dev building Focura.");
  });

  it("200 — updates timezone (any string accepted, no validation)", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ timezone: "Asia/Dhaka" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.timezone).toBe("Asia/Dhaka");
  });

  it("200 — invalid timezone string is accepted (controller does no timezone validation)", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ timezone: "Not/A/Real/Timezone" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.timezone).toBe("Not/A/Real/Timezone");
  });

  it("200 — updates image URL", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ image: "https://cdn.focura.com/avatar.png" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.image).toBe("https://cdn.focura.com/avatar.png");
  });

  it("200 — empty string name is accepted (controller has no min-length check)", async () => {
    const user = await createUser({ name: "Real Name" });

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ name: "" });

    expect(res.status).toBe(200);
  });

  it("200 — empty body (no fields) is a no-op, returns current profile", async () => {
    const user = await createUser({ name: "Unchanged" });

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Unchanged");
  });

  it("200 — theme and notifications fields are silently ignored (not in controller)", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ theme: "dark", notifications: false, name: "Valid Name" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Valid Name");
    expect(res.body.data.user.theme).toBeUndefined();
  });

  it("400 — name as non-string type causes 400", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ name: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid name format");
  });

  it("400 — bio as non-string type causes 400", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ bio: ["array", "not", "string"] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid bio format");
  });

  it("400 — timezone as non-string type causes 400", async () => {
    const user = await createUser();

    const res = await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user))
      .send({ timezone: { zone: "invalid" } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid timezone format");
  });

  it("200 — only updates the requesting user, not others", async () => {
    const user1 = await createUser({ name: "User One" });
    const user2 = await createUser({ name: "User Two" });

    await request(app)
      .put(`${BASE}/profile`)
      .set(await authWithCsrfHeaders(user1))
      .send({ name: "User One Updated" });

    const db2 = await prisma.user.findUnique({ where: { id: user2.id } });
    expect(db2?.name).toBe("User Two");
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app)
      .put(`${BASE}/profile`)
      .send({ name: "No auth" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/user/workspace-members
// Safe method — authHeaders only, no CSRF needed
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/user/workspace-members", () => {
  it("200 — returns members of workspaces the user belongs to", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser({ name: "Workspace Member" });
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`${BASE}/workspace-members`)
      .set(authHeaders(owner));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(member.id);
  });

  it("200 — each member only has id, name, email, image (no sensitive fields)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await addMemberToWorkspace(
      (await createUser()).id,
      workspace.id,
      WorkspaceRole.MEMBER,
    );

    const res = await request(app)
      .get(`${BASE}/workspace-members`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const members = res.body.data;
    expect(members.length).toBeGreaterThan(0);
    members.forEach((m: any) => {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("email");
      expect(m).toHaveProperty("image");
      expect(m).toHaveProperty("role");
      expect(m).not.toHaveProperty("password");
    });
  });

  it("200 — results are deduplicated (distinct by id)", async () => {
    const { user: owner1, workspace: ws1 } = await createWorkspaceWithOwner();
    const { workspace: ws2 } = await createWorkspaceWithOwner(
      { email: "owner2@focura.test" },
      { slug: "ws-second" },
    );
    const sharedMember = await createUser();
    await addMemberToWorkspace(sharedMember.id, ws1.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(sharedMember.id, ws2.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(owner1.id, ws2.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`${BASE}/workspace-members`)
      .set(authHeaders(owner1));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    const sharedMemberCount = ids.filter(
      (id: string) => id === sharedMember.id,
    ).length;
    expect(sharedMemberCount).toBe(1);
  });

  it("200 — empty array when user has no workspace memberships", async () => {
    const loneUser = await createUser();

    const res = await request(app)
      .get(`${BASE}/workspace-members`)
      .set(authHeaders(loneUser));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get(`${BASE}/workspace-members`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/user/password + GET /api/v1/user/security
// Password changes now stamp lastPasswordChange (password-age tracking).
// ─────────────────────────────────────────────────────────────────────────────
describe("password change & security settings (lastPasswordChange)", () => {
  it("200 — changing the password records lastPasswordChange in security settings", async () => {
    const user = await createUser();

    // Before any change: lastPasswordChange is null
    const before = await request(app)
      .get(`${BASE}/security`)
      .set(authHeaders(user));
    expect(before.status).toBe(200);
    expect(before.body.data.lastPasswordChange).toBeNull();

    const res = await request(app)
      .put(`${BASE}/password`)
      .set(await authWithCsrfHeaders(user))
      .send({ currentPassword: "TestPass1234!", newPassword: "NewPass5678!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await request(app)
      .get(`${BASE}/security`)
      .set(authHeaders(user));
    expect(after.status).toBe(200);
    expect(after.body.data.lastPasswordChange).toBeTruthy();
    expect(new Date(after.body.data.lastPasswordChange).getTime()).toBeGreaterThan(0);
  });

  it("401 — a wrong current password does not stamp lastPasswordChange", async () => {
    const user = await createUser();
    const res = await request(app)
      .put(`${BASE}/password`)
      .set(await authWithCsrfHeaders(user))
      .send({ currentPassword: "WrongPass!", newPassword: "NewPass5678!" });
    expect(res.status).toBe(401);

    const sec = await request(app)
      .get(`${BASE}/security`)
      .set(authHeaders(user));
    expect(sec.body.data.lastPasswordChange).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Active session management (Security page)
// ─────────────────────────────────────────────────────────────────────────────
describe("Sessions endpoints", () => {
  it("GET /sessions — 200 with an array of sessions", async () => {
    const user = await createUser();

    const res = await request(app)
      .get(`${BASE}/sessions`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /sessions — includes a tracked session with isCurrent true", async () => {
    const user = await createUser();
    const sessionId = "itest-session-1";
    await getRedisClient().sadd(`user:sessions:${user.id}`, sessionId);
    await getRedisClient().setex(
      `session:metadata:${sessionId}`,
      3600,
      JSON.stringify({
        deviceId: null,
        ipAddress: "127.0.0.1",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        lastActivity: Date.now(),
      }),
    );

    const token = generateTestToken(user, { sessionId });
    const res = await request(app)
      .get(`${BASE}/sessions`)
      .set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);
    const session = res.body.data.find((s: any) => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session.isCurrent).toBe(true);
    expect(session.browser).toBe("Chrome");
    expect(session.os).toBe("Windows");

    // Cleanup
    await getRedisClient().srem(`user:sessions:${user.id}`, sessionId);
    await getRedisClient().del(`session:metadata:${sessionId}`);
  });

  it("DELETE /sessions — 200 revokes other sessions", async () => {
    const user = await createUser();

    const res = await request(app)
      .delete(`${BASE}/sessions`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /sessions/:id — 404 for a session that is not the user's", async () => {
    const user = await createUser();

    const res = await request(app)
      .delete(`${BASE}/sessions/nonexistent-session`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });
});
