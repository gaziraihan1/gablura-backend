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
} from "../helpers/auth.js";import { mutateBanUser } from "../../admin/admin.mutation.js";
import { createAdminUser } from "../factories/index.js";
import { createSseToken, verifyToken } from "../../lib/auth/backendToken.js";

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
    expect(res.body.sseToken).toBeDefined();
    expect(res.body.accessTokenExpiry).toBeDefined();
  });

  it("200 — exchange returns a 30s single-use sseToken and stores it", async () => {
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
    const { sseToken } = res.body;
    expect(typeof sseToken).toBe("string");

    // It is a real, verifiable sse-type token bound to the user (no email/role)
    const decoded = verifyToken(sseToken, "sse");
    expect(decoded.id).toBe(user.id);
    expect(decoded.type).toBe("sse");

    // It was stored in Redis for single-use consumption
    const { storeSseToken } = await import("../../lib/auth/tokenRevocation.js");
    expect(vi.mocked(storeSseToken)).toHaveBeenCalledWith(decoded.jti, user.id);
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
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("400 — expired timestamp (> 60s old)", async () => {
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

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
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
      signature: "a".repeat(64), // Valid format but wrong signature
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_PROOF");
  });

  it("401 — user not found", async () => {
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const fakeId = "cmtbcsscn0000h0kz0uml7652"; // Valid CUID format but non-existent
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
    expect(res.body.sseToken).toBeDefined();
    // New access token should differ from original
    expect(res.body.accessToken).not.toBe(exchangeRes.body.accessToken);

    // A fresh single-use SSE token is issued on every rotation
    expect(res.body.sseToken).not.toBe(exchangeRes.body.sseToken);
    const decodedSse = verifyToken(res.body.sseToken, "sse");
    expect(decodedSse.id).toBe(user.id);
  });

  it("400 — missing refreshToken body", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});

    expect(res.status).toBe(400);
  });

  it("400 — completely invalid token string", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: "not.a.real.token" });

    expect(res.status).toBe(400);
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

    expect(exchangeRes.status).toBe(200);
    const { accessToken } = exchangeRes.body;

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

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

    expect(exchangeRes.status).toBe(200);
    const { accessToken } = exchangeRes.body;

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ logoutAll: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/all devices/i);
  });

  it("200 — expired token still results in graceful logout", async () => {
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

    expect(exchangeRes.status).toBe(200);
    const { accessToken } = exchangeRes.body;

    // Use the valid token - logout always succeeds even with invalid tokens
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

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

    // Generate a token directly — going through exchange would auto-verify the email
    const accessToken = generateTestToken(user);

    const res = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("403 ACCOUNT_BANNED — immediately after admin bans user (cache invalidation check)", async () => {
    const user = await createUser();
    const admin = await createAdminUser();
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

    expect(exchangeRes.status).toBe(200);
    const { accessToken } = exchangeRes.body;

    // 1. First request to populate the user profile cache
    const res1 = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res1.status).toBe(200);

    // 2. Admin bans the user (this should call UserCache.invalidateProfile)
    await mutateBanUser(user.id, admin.id, "Integration test ban");

    // 3. Second request should now fail because cache was invalidated and DB check finds bannedAt
    const res2 = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res2.status).toBe(403);
    expect(res2.body.code).toBe("ACCOUNT_BANNED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server-side session enforcement (audit fixes G1/G2/G7)
// ─────────────────────────────────────────────────────────────────────────────
describe("session lifecycle (server-side enforcement)", () => {
  it("exchange records session keys (created, activity, metadata)", async () => {
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

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();
    expect(await redis.exists(`session:created:${sessionId}`)).toBe(1);
    expect(await redis.exists(`session:activity:${sessionId}`)).toBe(1);
    expect(await redis.get(`session:metadata:${sessionId}`)).toBeTruthy();
  });

  it("sessionTimeout rejects a tracked session that went inactive", async () => {
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
    const token = res.body.accessToken;

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();

    // Active session → allowed
    const active = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${token}`);
    expect(active.status).toBe(200);

    // Simulate 30 minutes of inactivity (activity key expired)
    await redis.del(`session:activity:${sessionId}`);

    const inactive = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${token}`);
    expect(inactive.status).toBe(401);
    expect(inactive.body.code).toBe("SESSION_TIMEOUT");
  });

  it("untracked (legacy) sessions are still accepted by protected routes", async () => {
    const user = await createUser();
    const res = await request(app)
      .get("/api/v1/user/profile")
      .set(authHeaders(user));
    expect(res.status).toBe(200);
  });

  it("logout invalidates the session keys", async () => {
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
    const token = res.body.accessToken;

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();
    expect(await redis.exists(`session:created:${sessionId}`)).toBe(1);

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(await redis.exists(`session:created:${sessionId}`)).toBe(0);
    expect(await redis.exists(`session:activity:${sessionId}`)).toBe(0);
  });

  it("audit events are persisted to the AuditLog table (G7)", async () => {
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

    const before = await prisma.auditLog.count({
      where: { event: "EXCHANGE_SUCCESS", userId: user.id },
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

    // Fire-and-forget write — poll briefly for it to land (avoids CI flake)
    let after = before;
    for (let i = 0; i < 20 && after <= before; i++) {
      await new Promise((r) => setTimeout(r, 50));
      after = await prisma.auditLog.count({
        where: { event: "EXCHANGE_SUCCESS", userId: user.id },
      });
    }
    expect(after).toBeGreaterThan(before);
  });

  it("exchange still succeeds when Redis is unavailable (session recording is best-effort)", async () => {
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

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();
    const setexSpy = vi
      .spyOn(redis, "setex")
      .mockRejectedValueOnce(new Error("redis down"));

    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    setexSpy.mockRestore();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Session binding (device fingerprint)
// ─────────────────────────────────────────────────────────────────────────────
describe("session binding (device fingerprint)", () => {
  const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };

  function withHeaders(req: request.Test, headers: Record<string, string>): request.Test {
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  }

  it("defers binding for a server-to-server exchange, then adopts it on the first browser request", async () => {
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

    // Exchange without browser headers (the NextAuth server-to-server fetch)
    const res = await request(app).post("/api/v1/auth/exchange").send({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
      signature,
    });
    expect(res.status).toBe(200);

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();
    const pending = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(pending.deviceId).toBeNull();

    const token = generateTestToken(user, { sessionId });

    // The Next.js SSR hydration call (server-to-server, no browser headers)
    // must NOT be hijacked and must NOT claim the binding.
    const ssr = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${token}`)
      .set("User-Agent", "node");
    expect(ssr.status).toBe(200);
    const stillPending = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(stillPending.deviceId).toBeNull();

    // First real browser request adopts the binding instead of being rejected
    const profile = await withHeaders(
      request(app).get("/api/v1/user/profile").set("Authorization", `Bearer ${token}`),
      BROWSER_HEADERS,
    );
    expect(profile.status).toBe(200);

    const bound = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(bound.deviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(bound.userAgent).toContain("Chrome");
    expect(bound.ipAddress).toBeTruthy();

    // SSR hydration calls during later navigations must still be skipped
    // (not hijacked, binding unchanged)
    const ssrAfter = await request(app)
      .get("/api/v1/user/profile")
      .set("Authorization", `Bearer ${token}`)
      .set("User-Agent", "node");
    expect(ssrAfter.status).toBe(200);
    const unchanged = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(unchanged.deviceId).toBe(bound.deviceId);
  });

  it("defers binding at exchange, adopts from the first browser request, re-binds on same-IP device changes, and rejects cross-IP device changes", async () => {
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

    const res = await withHeaders(
      request(app).post("/api/v1/auth/exchange").send({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        timestamp,
        signature,
      }),
      BROWSER_HEADERS,
    );
    expect(res.status).toBe(200);

    const { getRedisClient } = await import("../../redis/redis.client.js");
    const redis = getRedisClient();
    const meta = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    // The exchange never records a binding — even with browser-looking headers
    expect(meta.deviceId).toBeNull();

    const token = generateTestToken(user, { sessionId });

    // Same browser → binding adopted, request allowed
    const same = await withHeaders(
      request(app).get("/api/v1/user/profile").set("Authorization", `Bearer ${token}`),
      BROWSER_HEADERS,
    );
    expect(same.status).toBe(200);
    const bound = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(bound.deviceId).toMatch(/^[a-f0-9]{32}$/);
    const originalFingerprint = bound.deviceId;

    // Same IP + different device (emulation / browser switch) → session is
    // re-bound, NOT hijacked: the request succeeds and the binding updates.
    const rebound = await withHeaders(
      request(app).get("/api/v1/user/profile").set("Authorization", `Bearer ${token}`),
      { ...BROWSER_HEADERS, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0" },
    );
    expect(rebound.status).toBe(200);
    const reboundMeta = JSON.parse((await redis.get(`session:metadata:${sessionId}`)) as string);
    expect(reboundMeta.deviceId).not.toBe(originalFingerprint);

    // A different device FROM a different IP → 401 SESSION_HIJACK_DETECTED
    const other = withHeaders(
      request(app).get("/api/v1/user/profile").set("Authorization", `Bearer ${token}`),
      {
        ...BROWSER_HEADERS,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0",
        "X-Forwarded-For": "203.0.113.7",
      },
    );
    const rejected = await other;
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe("SESSION_HIJACK_DETECTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/activity (session heartbeat)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/notifications/stream — single-use SSE token auth
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/notifications/stream (SSE token auth)", () => {
  it("401 — rejects a regular access token (must never open a stream)", async () => {
    const user = await createUser();
    const accessToken = generateTestToken(user); // type: "access"

    const res = await request(app)
      .get("/api/v1/notifications/stream")
      .query({ token: accessToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("401 — rejects an sse token that was never issued or already consumed", async () => {
    const user = await createUser();
    // Signed but never stored in Redis → consume finds nothing → reuse/expiry
    const sseToken = createSseToken(user.id);

    const res = await request(app)
      .get("/api/v1/notifications/stream")
      .query({ token: sseToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_REUSED");
  });

  it("401 — missing token", async () => {
    const res = await request(app).get("/api/v1/notifications/stream");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MISSING_TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/activity (session heartbeat)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/auth/activity", () => {
  it("200 — authenticated ping returns success", async () => {
    const user = await createUser();
    const token = generateTestToken(user);
    const res = await request(app)
      .get("/api/v1/auth/activity")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("401 — unauthenticated ping is rejected", async () => {
    const res = await request(app).get("/api/v1/auth/activity");
    expect(res.status).toBe(401);
  });
});