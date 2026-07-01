import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../../middleware/auth.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

// Mock ioredis client — used by session binding and revocation in auth.ts
const mockRedisGet = vi.fn(async (): Promise<string | null> => null);
const mockRedisSetex = vi.fn(async () => "OK");

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get:   mockRedisGet,
    setex: mockRedisSetex,
    del:   vi.fn(async () => 1),
  })),
}));

vi.mock("../../../lib/auth/sessionBinding.js", () => ({
  getClientIp:            vi.fn(() => "127.0.0.1"),
  validateSessionBinding: vi.fn(() => ({ valid: true })),
}));

vi.mock("../../../lib/auth/tokenRevocation.js", () => ({
  isAccessTokenRevoked:   vi.fn(async () => false),
  revokeAllRefreshTokens: vi.fn(async () => {}),
}));

vi.mock("../../../lib/auth/auditLog.js", () => ({
  auditLog: vi.fn(),
}));

vi.mock("../../../lib/redis/cache.client.js", () => ({
  CacheClient: {
    get: vi.fn(),
    set: vi.fn(),
  },
  CACHE_KEYS: {
    authResult: vi.fn((jti: string) => `auth:result:${jti}`),
    userProfile: vi.fn((id: string) => `user:profile:${id}`),
  },
  CACHE_TTL: {
    USER_PROFILE: 1800,
    AUTH_RESULT: 300,
  },
}));

import { authenticate, authorize } from "../../../middleware/auth.js";
import { prisma } from "../../../lib/prisma.js";
import { CacheClient } from "../../../lib/redis/cache.client.js";
import {
  generateTestToken,

  expiredAuthHeaders,
  invalidAuthHeaders,
} from "../../helpers/auth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-test-001",
  email: "test@focura.com",
  name: "Test User",
  role: "USER" as const,
  emailVerified: new Date(),
  bannedAt: null,
  banReason: null,
};

function makeReq(authHeader?: string): AuthRequest {
  return {
    headers: { authorization: authHeader },
    socket:  { remoteAddress: "127.0.0.1" },
    ip:      "127.0.0.1",
  } as unknown as AuthRequest;
}

function makeRes(): Response {
  return {
    status:    vi.fn().mockReturnThis(),
    json:      vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

/** Extract the first argument passed to next() and assert it's an AppError. */
function getNextError(next: ReturnType<typeof makeNext>) {
  const calls = vi.mocked(next).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0] as any;
}

function getTestPrivateKey(): string {
  const keyPath = process.env.JWT_PRIVATE_KEY_PATH;
  if (!keyPath) throw new Error("JWT_PRIVATE_KEY_PATH is not set.");
  return readFileSync(keyPath, "utf-8");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSetex.mockResolvedValue("OK" as any);
});

describe("authenticate middleware", () => {

  it("calls next() and attaches req.user for a valid token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    const next = makeNext();
    const req  = makeReq(`Bearer ${generateTestToken(mockUser)}`);
    await authenticate(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    // next() called with no arguments = success
    expect(vi.mocked(next).mock.calls[0][0]).toBeUndefined();
    expect(req.user?.id).toBe(mockUser.id);
    expect(req.user?.email).toBe(mockUser.email);
    expect(req.user?.role).toBe(mockUser.role);
    expect((req.user as any)?.bannedAt).toBeUndefined();
  });

  it("returns 401 NO_TOKEN when Authorization header is absent", async () => {
    const next = makeNext();
    await authenticate(makeReq(undefined), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("NO_TOKEN");
  });

  it("returns 401 NO_TOKEN when Authorization is not Bearer scheme", async () => {
    const next = makeNext();
    await authenticate(makeReq("Basic dXNlcjpwYXNz"), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("NO_TOKEN");
  });

  it("returns 401 NO_TOKEN for empty Bearer string", async () => {
    const next = makeNext();
    await authenticate(makeReq("Bearer "), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("NO_TOKEN");
  });

  it("returns 401 INVALID_TOKEN for a completely malformed token", async () => {
    const next = makeNext();
    await authenticate(makeReq(invalidAuthHeaders().Authorization), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 TOKEN_EXPIRED for an expired token", async () => {
    const next = makeNext();
    await authenticate(makeReq(expiredAuthHeaders(mockUser).Authorization), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("TOKEN_EXPIRED");
  });

  it("returns 401 TOKEN_VERSION_MISMATCH for token with wrong version", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const token = jwt.sign(
      {
        sub: mockUser.id, email: mockUser.email, role: mockUser.role,
        type: "access", version: 99, jti: "test-jti", sessionId: "test-session",
      },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${token}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("TOKEN_VERSION_MISMATCH");
  });

  it("returns 401 INVALID_TOKEN_TYPE for refresh token used as access token", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const token = jwt.sign(
      {
        sub: mockUser.id, email: mockUser.email, role: mockUser.role,
        type: "refresh", version: 1, jti: "test-jti", sessionId: "test-session",
      },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${token}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("INVALID_TOKEN_TYPE");
  });

  it("returns 401 TOKEN_REVOKED when isAccessTokenRevoked returns true", async () => {
    const { isAccessTokenRevoked } = await import("../../../lib/auth/tokenRevocation.js");
    vi.mocked(isAccessTokenRevoked).mockResolvedValueOnce(true);

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("TOKEN_REVOKED");
  });

  it("returns 401 USER_NOT_FOUND when user was deleted after token issued", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("USER_NOT_FOUND");
  });

  it("returns 403 EMAIL_NOT_VERIFIED for user with null emailVerified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, emailVerified: null } as any);

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("returns 403 ACCOUNT_BANNED for a banned user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, bannedAt: new Date(), banReason: "ToS violation",
    } as any);

    const next = makeNext();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("ACCOUNT_BANNED");
  });

  it("uses cached user profile and skips DB lookup", async () => {
    const cachedUser = { ...mockUser };
    vi.mocked(CacheClient.get)
      .mockResolvedValueOnce(null) // Auth result cache miss
      .mockResolvedValueOnce(cachedUser as any); // User profile cache hit

    const next = makeNext();
    const req = makeReq(`Bearer ${generateTestToken(mockUser)}`);
    await authenticate(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(req.user?.id).toBe(mockUser.id);
  });

  it("fast-fails when auth result cache indicates token is invalid", async () => {
    vi.mocked(CacheClient.get).mockResolvedValueOnce({ valid: false });

    const next = makeNext();
    const req = makeReq(`Bearer ${generateTestToken(mockUser)}`);
    await authenticate(req, makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("INVALID_TOKEN_CACHED");
    expect(err.message).toBe("Invalid token");
  });

  it("caches successful authentication results", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
    vi.mocked(CacheClient.get).mockResolvedValue(null); // Force miss

    const next = makeNext();
    const req = makeReq(`Bearer ${generateTestToken(mockUser)}`);
    await authenticate(req, makeRes(), next);

    expect(CacheClient.set).toHaveBeenCalledWith(
      expect.stringContaining("auth:result:"),
      { userId: mockUser.id, valid: true },
      expect.any(Number)
    );
  });

  it("returns 401 SESSION_HIJACK_DETECTED when session binding fails", async () => {

    const fakeMetadata = JSON.stringify({
      ip: "1.2.3.4",
      userAgent: "OtherBrowser/1.0",
      lastActivity: Date.now(),
    });
    mockRedisGet.mockResolvedValueOnce(fakeMetadata);

    const { validateSessionBinding } = await import("../../../lib/auth/sessionBinding.js");
    vi.mocked(validateSessionBinding).mockReturnValueOnce({ valid: false, reason: "IP address changed" });

    const { revokeAllRefreshTokens } = await import("../../../lib/auth/tokenRevocation.js");

    const next  = makeNext();
    const token = generateTestToken(mockUser, { sessionId: "bound-session" });
    await authenticate(makeReq(`Bearer ${token}`), makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("SESSION_HIJACK_DETECTED");
    expect(revokeAllRefreshTokens).toHaveBeenCalledWith(mockUser.id);
  });

  // ─── authorize() ────────────────────────────────────────────────────────────

  it("authorize() — passes when user has required role", () => {
    const next = makeNext();
    const req  = { user: { id: "1", email: "a@b.com", role: "ADMIN" } } as AuthRequest;
    authorize("ADMIN", "USER")(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(vi.mocked(next).mock.calls[0][0]).toBeUndefined();
  });

  it("authorize() — returns 403 FORBIDDEN when user lacks required role", () => {
    const next = makeNext();
    const req  = { user: { id: "1", email: "a@b.com", role: "USER" } } as AuthRequest;
    authorize("ADMIN")(req, makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("authorize() — returns 401 NOT_AUTHENTICATED when req.user is missing", () => {
    const next = makeNext();
    const req  = { headers: {} } as AuthRequest;
    authorize("ADMIN")(req, makeRes(), next);

    const err = getNextError(next);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("NOT_AUTHENTICATED");
  });
});