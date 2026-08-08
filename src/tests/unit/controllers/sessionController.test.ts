import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";
import type { AuthRequest } from "../../../middleware/auth.js";

const {
  mockGetUserActiveSessions,
  mockRevokeUserSession,
  mockMarkSessionRevoked,
  mockAuditLog,
} = vi.hoisted(() => ({
  mockGetUserActiveSessions: vi.fn(),
  mockRevokeUserSession: vi.fn(),
  mockMarkSessionRevoked: vi.fn(),
  mockAuditLog: vi.fn(),
}));

vi.mock("../../../lib/auth/sessionManager.js", () => ({
  getUserActiveSessions: mockGetUserActiveSessions,
  revokeUserSession: mockRevokeUserSession,
}));

vi.mock("../../../lib/auth/tokenRevocation.js", () => ({
  markSessionRevoked: mockMarkSessionRevoked,
}));

vi.mock("../../../lib/auth/auditLog.js", () => ({
  auditLog: mockAuditLog,
}));

import {
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
} from "../../../controllers/session.controller.js";

function createRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
  };
  return res as Response;
}

function createReq(overrides: Record<string, any> = {}): AuthRequest {
  return {
    user: {
      id: "user-1",
      email: "a@b.c",
      role: "USER",
      sessionId: "current-session",
    },
    params: {},
    query: {},
    ...overrides,
  } as AuthRequest;
}

const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const CHROME_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";

describe("session.controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserActiveSessions.mockResolvedValue([]);
  });

  describe("getActiveSessions", () => {
    it("maps sessions to the ActiveSession shape with isCurrent", async () => {
      mockGetUserActiveSessions.mockResolvedValue([
        {
          sessionId: "current-session",
          deviceInfo: CHROME_DESKTOP_UA,
          ipAddress: "127.0.0.1",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          sessionId: "other-session",
          deviceInfo: CHROME_MOBILE_UA,
          ipAddress: "192.168.1.5",
          lastActivity: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ]);

      const res = createRes();
      await getActiveSessions(createReq(), res);

      expect(res.statusCode).toBe(200);
      const data = (res as any).body.data;
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        id: "current-session",
        device: "Desktop",
        browser: "Chrome",
        os: "Windows",
        isCurrent: true,
        location: "Local network",
      });
      expect(data[1]).toMatchObject({
        id: "other-session",
        device: "Mobile",
        os: "Android",
        isCurrent: false,
      });
    });

    it("returns 401 without an authenticated user", async () => {
      const res = createRes();
      await getActiveSessions({} as AuthRequest, res);
      expect(res.statusCode).toBe(401);
    });
  });

  describe("revokeSession", () => {
    it("revokes an owned session and tombstones it", async () => {
      mockGetUserActiveSessions.mockResolvedValue([
        { sessionId: "s1", deviceInfo: "x", lastActivity: "", createdAt: "" },
      ]);

      const res = createRes();
      await revokeSession(createReq({ params: { sessionId: "s1" } }), res);

      expect(res.statusCode).toBe(200);
      expect(mockMarkSessionRevoked).toHaveBeenCalledWith("s1");
      expect(mockRevokeUserSession).toHaveBeenCalledWith("user-1", "s1");
      expect(mockAuditLog).toHaveBeenCalledWith("SESSION_REVOKED", expect.anything());
    });

    it("404 for a session that does not belong to the user", async () => {
      mockGetUserActiveSessions.mockResolvedValue([
        { sessionId: "mine", deviceInfo: "x", lastActivity: "", createdAt: "" },
      ]);

      const res = createRes();
      await revokeSession(createReq({ params: { sessionId: "theirs" } }), res);

      expect(res.statusCode).toBe(404);
      expect(mockMarkSessionRevoked).not.toHaveBeenCalled();
      expect(mockRevokeUserSession).not.toHaveBeenCalled();
    });
  });

  describe("revokeAllOtherSessions", () => {
    it("revokes every session except the current one", async () => {
      mockGetUserActiveSessions.mockResolvedValue([
        { sessionId: "current-session", deviceInfo: "x", lastActivity: "", createdAt: "" },
        { sessionId: "a", deviceInfo: "x", lastActivity: "", createdAt: "" },
        { sessionId: "b", deviceInfo: "x", lastActivity: "", createdAt: "" },
      ]);

      const res = createRes();
      await revokeAllOtherSessions(createReq(), res);

      expect(res.statusCode).toBe(200);
      expect(mockMarkSessionRevoked).toHaveBeenCalledWith("a");
      expect(mockMarkSessionRevoked).toHaveBeenCalledWith("b");
      expect(mockMarkSessionRevoked).not.toHaveBeenCalledWith("current-session");
    });
  });
});
