// src/tests/integrations/auth/auth.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Your auth flow (from auth.routes.ts):
//   POST /api/v1/auth/exchange  ← NextAuth sends HMAC-signed proof → gets RS256 tokens
//   POST /api/v1/auth/refresh   ← Rotates refresh token
//   POST /api/v1/auth/logout    ← Revokes tokens (graceful even without Redis)
//
// There is NO /register or /login endpoint — NextAuth handles that.
// Tests use: factory createUser() + buildExchangeProof() + authHeaders()
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser, createUnverifiedUser } from "../factories/index.js";
import {
  authHeaders,
  expiredAuthHeaders,
  invalidAuthHeaders,
  buildExchangeProof,
  generateTestToken,
} from "../helpers/auth.js";

import { mutateBanUser } from "../../admin/admin.mutation.js";
import { createAdminUser } from "../factories/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/exchange
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/auth/exchange", () => {
  it("200 — valid HMAC proof issues access + refresh tokens", async () => {
    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.accessTokenExpiry).toBeDefined();
  });

  it("200 — sets emailVerified on first exchange for unverified user", async () => {
    const user = await createUser({ emailVerified: null });
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    // Exchange allows unverified if email matches — then sets emailVerified
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerified).not.toBeNull();
  });

  it("400 — missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/auth/exchange")
      .send({ userId: "abc" }); // missing email, role, sessionId, timestamp, signature

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
  });

  it("401 — expired timestamp (> 60s old)", async () => {
    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now() - 70_000; // 70 seconds ago
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PROOF_EXPIRED");
  });

  it("401 — invalid HMAC signature", async () => {
    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now();

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature:
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_PROOF");
  });

  it("401 — user not found", async () => {
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const fakeId = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
    const signature = buildExchangeProof({
      userId: fakeId,
      email: "ghost@test.com",
      role: "USER",
      sessionId,
      timestamp,
    });

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: fakeId,
      email: "ghost@test.com",
      role: "USER",
      sessionId,
      timestamp,
      signature,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("200 — idempotent: same sessionId returns same tokens (without Redis, just re-issues)", async () => {
    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const body = {
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    };

    const res1 = await request(app).post("/api/v1/auth/exchange").send(body);
    const res2 = await request(app).post("/api/v1/auth/exchange").send(body);

    // Both should succeed — without Redis cache, both issue fresh tokens
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/auth/refresh", () => {
  it("200 — valid refresh token returns new token pair", async () => {
    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    // Get a real refresh token via exchange
    const exchangeRes = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    expect(exchangeRes.status).toBe(200);
    const { refreshToken } = exchangeRes.body;

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // New access token should differ from original
    expect(res.body.accessToken).not.toBe(exchangeRes.body.accessToken);
  });

  it("400 — missing refreshToken body", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});

    expect(res.status).toBe(400);
  });

  it("401 — completely invalid token string", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: "not.a.real.token" });

    expect(res.status).toBe(401);
  });

  it("401 — rotateRefreshToken returns false (token already used)", async () => {
    // rotateRefreshToken is mocked to return false for this test
    const { rotateRefreshToken } =
      await import("../../lib/auth/tokenRevocation.js");
    vi.mocked(rotateRefreshToken).mockResolvedValueOnce(false);

    const user = await createUser();
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const exchangeRes = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: exchangeRes.body.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_REPLAY_DETECTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/auth/logout", () => {
  it("200 — authenticated user can logout", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it("200 — logout succeeds even without Authorization header (graceful)", async () => {
    // From auth.routes.ts: logout always returns 200 — it's fire-and-forget
    const res = await request(app).post("/api/v1/auth/logout").send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("200 — logout with logoutAll=true", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set(authHeaders(user))
      .send({ logoutAll: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/all devices/i);
  });

  it("200 — expired token still results in graceful logout", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set(expiredAuthHeaders(user));

    // logout always succeeds — it catches token errors internally
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/user/me — uses authenticate middleware
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/user/profile", () => {
  it("200 — authenticated user gets their profile without password", async () => {
    const user = await createUser({
      name: "Profile Test",
      email: "me@focura.test",
    });

    const res = await request(app)
      .get("/api/v1/user/profile")
      .set(authHeaders(user));
    const data = res.body.data;
    expect(res.status).toBe(200);
    expect(data.user.id).toBe(user.id);
    expect(data.user.email).toBe("me@focura.test");
    expect(data.user.password).toBeUndefined();
  });

  it("401 NO_TOKEN — no Authorization header", async () => {
    const res = await request(app).get("/api/v1/user/profile");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_TOKEN");
  });

  it("401 TOKEN_EXPIRED — expired token", async () => {
    const user = await createUser();
    const res = await request(app)
      .get("/api/v1/user/profile")
      .set(expiredAuthHeaders(user));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("401 INVALID_TOKEN — malformed token", async () => {
    const res = await request(app)
      .get("/api/v1/user/profile")
      .set(invalidAuthHeaders());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("403 EMAIL_NOT_VERIFIED — unverified user cannot access protected routes", async () => {
    const user = await createUnverifiedUser();

    const res = await request(app)
      .get("/api/v1/user/profile")
      .set(authHeaders(user));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("403 ACCOUNT_BANNED — immediately after admin bans user (cache invalidation check)", async () => {
    const user = await createUser();
    const admin = await createAdminUser();
    const headers = authHeaders(user);

    // 1. First request to populate the user profile cache
    const res1 = await request(app)
      .get("/api/v1/user/profile")
      .set(headers);
    expect(res1.status).toBe(200);

    // 2. Admin bans the user (this should call UserCache.invalidateProfile)
    await mutateBanUser(user.id, admin.id, "Integration test ban");

    // 3. Second request should now fail because cache was invalidated and DB check finds bannedAt
    const res2 = await request(app)
      .get("/api/v1/user/profile")
      .set(headers);

    expect(res2.status).toBe(403);
    expect(res2.body.code).toBe("ACCOUNT_BANNED");
  });
  });

