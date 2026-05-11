// src/tests/unit/middleware/authenticate.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../../middleware/auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — must be declared before any imports that pull in the real modules.
//
// 1. prisma  — avoid real DB calls
// 2. redis   — avoid Upstash calls; keeps token-revocation path a no-op so
//              authenticate() reaches the DB check every time
// 3. sessionBinding — validateSessionBinding always returns valid so the
//              session-hijack branch never fires in unit tests
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// redis is mocked as a controllable object.
// By default its methods return null/undefined so no branch fires.
// Individual tests override specific methods via vi.mocked().
vi.mock("../../../lib/redis.js", () => ({
  redis: {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    exists: vi.fn(async () => 0),
  },
}));

vi.mock("../../../lib/auth/sessionBinding.js", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  validateSessionBinding: vi.fn(() => ({ valid: true })),
}));

// tokenRevocation is dynamically imported inside authenticate(); mock it too
vi.mock("../../../lib/auth/tokenRevocation.js", () => ({
  isAccessTokenRevoked: vi.fn(async () => false),
  revokeAllRefreshTokens: vi.fn(async () => {}),
}));

vi.mock("../../../lib/auth/auditLog.js", () => ({
  auditLog: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Real imports (after mocks are wired up)
// ─────────────────────────────────────────────────────────────────────────────
import { authenticate } from "../../../middleware/auth.js";
import { prisma } from "../../../lib/prisma.js";
import {
  generateTestToken,
  expiredAuthHeaders,
  invalidAuthHeaders,
} from "../../helpers/auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
const mockUser = {
  id: "user-test-001",
  email: "test@focura.com",
  name: "Test User",
  role: "USER" as const,
  emailVerified: new Date(),
  bannedAt: null,
  banReason: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeReq(authHeader?: string): AuthRequest {
  return {
    headers: { authorization: authHeader },
    socket: { remoteAddress: "127.0.0.1" },
    ip: "127.0.0.1",
  } as unknown as AuthRequest;
}

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = vi.fn();

/**
 * Read the RSA private key written by globalSetup to a temp file.
 * TEST_JWT_PRIVATE_KEY_PATH is set by globalSetup.ts — not JWT_PRIVATE_KEY_TEST.
 */
function getTestPrivateKey(): string {
  const keyPath = process.env.TEST_JWT_PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "TEST_JWT_PRIVATE_KEY_PATH is not set. " +
        "Ensure globalSetup.ts ran before this test file.",
    );
  }
  return readFileSync(keyPath, "utf-8");
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Default redis behaviour: return null for .get() so neither the revocation
  // block nor the session-binding block fires unless a test explicitly enables them.
  const { redis } = await import("../../../lib/redis.js");
  vi.mocked(redis!.get).mockResolvedValue(null);
  vi.mocked(redis!.setex).mockResolvedValue("OK" as any);

  // Ensure Redis env var is absent so authenticate() skips revocation check
  delete process.env.UPSTASH_REDIS_REST_URL;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("authenticate middleware", () => {
  // ── Happy path ──────────────────────────────────────────────────────────────
  it("calls next() and attaches req.user for a valid token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    const token = generateTestToken(mockUser);
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // no error argument
    expect(req.user?.id).toBe(mockUser.id);
    expect(req.user?.email).toBe(mockUser.email);
    expect(req.user?.role).toBe(mockUser.role);
    // Sensitive fields must NOT leak onto req.user
    expect((req.user as any)?.password).toBeUndefined();
    expect((req.user as any)?.bannedAt).toBeUndefined();
  });

  // ── Missing / malformed Authorization header ─────────────────────────────
  it("returns 401 NO_TOKEN when Authorization header is absent", async () => {
    const req = makeReq(undefined);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_TOKEN" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 NO_TOKEN when Authorization is not Bearer scheme", async () => {
    const req = makeReq("Basic dXNlcjpwYXNz");
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_TOKEN" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 NO_TOKEN for empty Bearer string", async () => {
    const req = makeReq("Bearer ");
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_TOKEN" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Invalid / malformed token ───────────────────────────────────────────────
  it("returns 401 INVALID_TOKEN for a completely malformed token", async () => {
    const req = makeReq(invalidAuthHeaders().Authorization);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_TOKEN" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Expired token ───────────────────────────────────────────────────────────
  it("returns 401 TOKEN_EXPIRED for an expired token", async () => {
    const req = makeReq(expiredAuthHeaders(mockUser).Authorization);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TOKEN_EXPIRED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Token payload validation ────────────────────────────────────────────────
  it("returns 401 TOKEN_VERSION_MISMATCH for token with wrong version", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const badVersionToken = jwt.sign(
      {
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        type: "access",
        version: 99, // middleware expects 1
        jti: "test-jti-bad-version",
        sessionId: "test-session",
      },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const req = makeReq(`Bearer ${badVersionToken}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TOKEN_VERSION_MISMATCH" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 INVALID_TOKEN_TYPE for refresh token used as access token", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const refreshToken = jwt.sign(
      {
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        type: "refresh", // middleware expects 'access'
        version: 1,
        jti: "test-jti-refresh",
        sessionId: "test-session",
      },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const req = makeReq(`Bearer ${refreshToken}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_TOKEN_TYPE" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Token revocation (Redis-enabled path) ───────────────────────────────────
  it("returns 401 TOKEN_REVOKED when isAccessTokenRevoked returns true", async () => {
    // Enable the Redis URL so authenticate() enters the revocation block
    process.env.UPSTASH_REDIS_REST_URL = "https://fake-redis.upstash.io";

    const { isAccessTokenRevoked } = await import(
      "../../../lib/auth/tokenRevocation.js"
    );
    vi.mocked(isAccessTokenRevoked).mockResolvedValueOnce(true);

    const token = generateTestToken(mockUser);
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TOKEN_REVOKED" }),
    );
    expect(next).not.toHaveBeenCalled();

    delete process.env.UPSTASH_REDIS_REST_URL;
  });

  // ── DB-level checks ─────────────────────────────────────────────────────────
  it("returns 401 USER_NOT_FOUND when user was deleted after token issued", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const token = generateTestToken(mockUser);
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "USER_NOT_FOUND" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 EMAIL_NOT_VERIFIED for user with null emailVerified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser,
      emailVerified: null,
    } as any);

    const token = generateTestToken(mockUser);
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 ACCOUNT_BANNED for a banned user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser,
      bannedAt: new Date(),
      banReason: "Terms of service violation",
    } as any);

    const token = generateTestToken(mockUser);
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ACCOUNT_BANNED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── Session-hijack detection ─────────────────────────────────────────────────
  it("returns 401 SESSION_HIJACK_DETECTED when session binding fails", async () => {
    // 1. Enable Redis env var so authenticate() enters the session-metadata block.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake-redis.upstash.io";

    // 2. Make redis.get() return stored session metadata so the binding check runs.
    const { redis } = await import("../../../lib/redis.js");
    const fakeMetadata = JSON.stringify({
      ip: "1.2.3.4",
      userAgent: "OtherBrowser/1.0",
      lastActivity: Date.now(),
    });
    vi.mocked(redis!.get).mockResolvedValueOnce(fakeMetadata as any);

    // 3. Make the user DB lookup succeed with a fully valid user so we reach
    //    the session-binding check (it runs before the DB lookup in auth flow).
    //    Actually the binding check is inside the sessionId block which runs
    //    before prisma — but prisma still needs to succeed afterward IF the
    //    binding passed. Here binding FAILS so prisma is never reached.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    // 4. Force validateSessionBinding to report a hijack.
    const { validateSessionBinding } = await import(
      "../../../lib/auth/sessionBinding.js"
    );
    vi.mocked(validateSessionBinding).mockReturnValueOnce({
      valid: false,
      reason: "IP address changed",
    });

    const { revokeAllRefreshTokens } = await import(
      "../../../lib/auth/tokenRevocation.js"
    );

    const token = generateTestToken(mockUser, { sessionId: "bound-session" });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SESSION_HIJACK_DETECTED" }),
    );
    expect(revokeAllRefreshTokens).toHaveBeenCalledWith(mockUser.id);
    expect(next).not.toHaveBeenCalled();

    delete process.env.UPSTASH_REDIS_REST_URL;
  });

  // ── authorize() helper ───────────────────────────────────────────────────────
  it("authorize() — passes when user has required role", async () => {
    const { authorize } = await import("../../../middleware/auth.js");

    const req = {
      user: { id: "1", email: "a@b.com", role: "ADMIN" },
    } as AuthRequest;
    const res = makeRes();
    const authorizeNext: NextFunction = vi.fn();

    authorize("ADMIN", "USER")(req, res, authorizeNext);

    expect(authorizeNext).toHaveBeenCalledOnce();
    expect(authorizeNext).toHaveBeenCalledWith();
  });

  it("authorize() — returns 403 FORBIDDEN when user lacks required role", async () => {
    const { authorize } = await import("../../../middleware/auth.js");

    const req = {
      user: { id: "1", email: "a@b.com", role: "USER" },
    } as AuthRequest;
    const res = makeRes();
    const authorizeNext: NextFunction = vi.fn();

    authorize("ADMIN")(req, res, authorizeNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(authorizeNext).not.toHaveBeenCalled();
  });

  it("authorize() — returns 401 NOT_AUTHENTICATED when req.user is missing", async () => {
    const { authorize } = await import("../../../middleware/auth.js");

    const req = { headers: {} } as AuthRequest; // no req.user
    const res = makeRes();
    const authorizeNext: NextFunction = vi.fn();

    authorize("ADMIN")(req, res, authorizeNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NOT_AUTHENTICATED" }),
    );
    expect(authorizeNext).not.toHaveBeenCalled();
  });
});