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
const mockRedisGet = vi.fn(async (): Promise<string | null> => null);const mockRedisSetex = vi.fn(async () => "OK");

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get:   mockRedisGet,
    setex: mockRedisSetex,
    del:   vi.fn(async () => 1),
  })),
}));

vi.mock("../../../lib/auth/sessionBinding.js", () => ({
  getClientIp:           vi.fn(() => "127.0.0.1"),
  validateSessionBinding: vi.fn(() => ({ valid: true })),
}));

vi.mock("../../../lib/auth/tokenRevocation.js", () => ({
  isAccessTokenRevoked:   vi.fn(async () => false),
  revokeAllRefreshTokens: vi.fn(async () => {}),
}));

vi.mock("../../../lib/auth/auditLog.js", () => ({
  auditLog: vi.fn(),
}));

import { authenticate } from "../../../middleware/auth.js";
import { prisma } from "../../../lib/prisma.js";
import {
  generateTestToken,
  expiredAuthHeaders,
  invalidAuthHeaders,
} from "../../helpers/auth.js";

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

const next: NextFunction = vi.fn();

function getTestPrivateKey(): string {
  const keyPath = process.env.TEST_JWT_PRIVATE_KEY_PATH;
  if (!keyPath) throw new Error("TEST_JWT_PRIVATE_KEY_PATH is not set.");
  return readFileSync(keyPath, "utf-8");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no stored session metadata, token not revoked
  mockRedisGet.mockResolvedValue(null);
  mockRedisSetex.mockResolvedValue("OK" as any);
});

describe("authenticate middleware", () => {

  it("calls next() and attaches req.user for a valid token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    const req = makeReq(`Bearer ${generateTestToken(mockUser)}`);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user?.id).toBe(mockUser.id);
    expect(req.user?.email).toBe(mockUser.email);
    expect(req.user?.role).toBe(mockUser.role);
    expect((req.user as any)?.bannedAt).toBeUndefined();
  });

  it("returns 401 NO_TOKEN when Authorization header is absent", async () => {
    const res = makeRes();
    await authenticate(makeReq(undefined), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NO_TOKEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 NO_TOKEN when Authorization is not Bearer scheme", async () => {
    const res = makeRes();
    await authenticate(makeReq("Basic dXNlcjpwYXNz"), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NO_TOKEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 NO_TOKEN for empty Bearer string", async () => {
    const res = makeRes();
    await authenticate(makeReq("Bearer "), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NO_TOKEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 INVALID_TOKEN for a completely malformed token", async () => {
    const res = makeRes();
    await authenticate(makeReq(invalidAuthHeaders().Authorization), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_TOKEN" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 TOKEN_EXPIRED for an expired token", async () => {
    const res = makeRes();
    await authenticate(makeReq(expiredAuthHeaders(mockUser).Authorization), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "TOKEN_EXPIRED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 TOKEN_VERSION_MISMATCH for token with wrong version", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const token = jwt.sign(
      { sub: mockUser.id, email: mockUser.email, role: mockUser.role, type: "access", version: 99, jti: "test-jti", sessionId: "test-session" },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${token}`), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "TOKEN_VERSION_MISMATCH" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 INVALID_TOKEN_TYPE for refresh token used as access token", async () => {
    const privateKey = getTestPrivateKey();
    const { default: jwt } = await import("jsonwebtoken");

    const token = jwt.sign(
      { sub: mockUser.id, email: mockUser.email, role: mockUser.role, type: "refresh", version: 1, jti: "test-jti", sessionId: "test-session" },
      privateKey,
      { algorithm: "RS256", issuer: "focura-app", audience: "focura-backend" },
    );

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${token}`), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_TOKEN_TYPE" }));
    expect(next).not.toHaveBeenCalled();
  });

  // Revocation check always runs now — no env var gate needed
  it("returns 401 TOKEN_REVOKED when isAccessTokenRevoked returns true", async () => {
    const { isAccessTokenRevoked } = await import("../../../lib/auth/tokenRevocation.js");
    vi.mocked(isAccessTokenRevoked).mockResolvedValueOnce(true);

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "TOKEN_REVOKED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 USER_NOT_FOUND when user was deleted after token issued", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "USER_NOT_FOUND" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 EMAIL_NOT_VERIFIED for user with null emailVerified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, emailVerified: null } as any);

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 ACCOUNT_BANNED for a banned user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, bannedAt: new Date(), banReason: "ToS violation" } as any);

    const res = makeRes();
    await authenticate(makeReq(`Bearer ${generateTestToken(mockUser)}`), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "ACCOUNT_BANNED" }));
    expect(next).not.toHaveBeenCalled();
  });

  // Session binding uses getRedisClient().get() now — mock mockRedisGet directly
  it("returns 401 SESSION_HIJACK_DETECTED when session binding fails", async () => {
  const fakeMetadata = JSON.stringify({
    ip: "1.2.3.4",
    userAgent: "OtherBrowser/1.0",
    lastActivity: Date.now(),
  });

  mockRedisGet.mockResolvedValueOnce(fakeMetadata);

  const { validateSessionBinding } = await import("../../../lib/auth/sessionBinding.js");
  vi.mocked(validateSessionBinding).mockReturnValueOnce({
    valid: false,
    reason: "IP address changed",
  });

  const { revokeAllRefreshTokens } = await import("../../../lib/auth/tokenRevocation.js");

  const token = generateTestToken(mockUser, { sessionId: "bound-session" });
  const res = makeRes();

  await authenticate(makeReq(`Bearer ${token}`), res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ code: "SESSION_HIJACK_DETECTED" })
  );

  expect(revokeAllRefreshTokens).toHaveBeenCalledWith(mockUser.id);
  expect(next).not.toHaveBeenCalled();
});

  it("authorize() — passes when user has required role", async () => {
    const { authorize } = await import("../../../middleware/auth.js");
    const req = { user: { id: "1", email: "a@b.com", role: "ADMIN" } } as AuthRequest;
    const authorizeNext: NextFunction = vi.fn();
    authorize("ADMIN", "USER")(req, makeRes(), authorizeNext);
    expect(authorizeNext).toHaveBeenCalledOnce();
  });

  it("authorize() — returns 403 FORBIDDEN when user lacks required role", async () => {
    const { authorize } = await import("../../../middleware/auth.js");
    const req = { user: { id: "1", email: "a@b.com", role: "USER" } } as AuthRequest;
    const res = makeRes();
    authorize("ADMIN")(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("authorize() — returns 401 NOT_AUTHENTICATED when req.user is missing", async () => {
    const { authorize } = await import("../../../middleware/auth.js");
    const req = { headers: {} } as AuthRequest;
    const res = makeRes();
    authorize("ADMIN")(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_AUTHENTICATED" }));
  });
});