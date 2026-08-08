import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    smembers: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    setex: vi.fn(),
  })),
}));

vi.mock("../../../lib/auth/auditLog.js", () => ({
  auditLog: vi.fn(),
}));

vi.mock("../../../lib/auth/tokenRevocation.js", () => ({
  markSessionRevoked: vi.fn().mockResolvedValue(undefined),
}));

import {
  trackUserSession,
  revokeUserSession,
  getUserActiveSessions,
} from "../../../lib/auth/sessionManager.js";
import { getRedisClient } from "../../../redis/redis.client.js";
import { auditLog } from "../../../lib/auth/auditLog.js";
import { markSessionRevoked } from "../../../lib/auth/tokenRevocation.js";

describe("sessionManager", () => {
  const mockRedis = {
    smembers: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    setex: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
  });

  describe("trackUserSession", () => {
    it("adds session when under max concurrent sessions", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["session-1", "session-2"]);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user-123", "session-3");

      expect(mockRedis.sadd).toHaveBeenCalledWith("user:sessions:user-123", "session-3");
      expect(mockRedis.expire).toHaveBeenCalledWith("user:sessions:user-123", 7 * 24 * 60 * 60);
      expect(auditLog).not.toHaveBeenCalled();
    });

    it("removes oldest session when max concurrent sessions reached", async () => {
      mockRedis.smembers.mockResolvedValueOnce([
        "session-1",
        "session-2",
        "session-3",
        "session-4",
        "session-5",
      ]);
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.setex.mockResolvedValueOnce(1);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user-123", "session-6");

      expect(auditLog).toHaveBeenCalledWith("MAX_SESSIONS_REACHED", {
        userId: "user-123",
        meta: { sessionCount: 5, limit: 5 },
      });
      expect(mockRedis.srem).toHaveBeenCalledWith("user:sessions:user-123", "session-1");
      expect(mockRedis.del).toHaveBeenCalledWith("session:metadata:session-1");
      // Evicted session is tombstoned so its tokens can no longer be used
      expect(markSessionRevoked).toHaveBeenCalledWith("session-1");
    });

    it("evicts the least-active session (Redis SETs have no order)", async () => {
      mockRedis.smembers.mockResolvedValueOnce([
        "session-1",
        "session-2",
        "session-3",
        "session-4",
        "session-5",
      ]);
      // session-3 has the oldest lastActivity
      mockRedis.get.mockImplementation(async (key: string) => {
        const map: Record<string, number> = {
          "session:metadata:session-1": 100,
          "session:metadata:session-2": 200,
          "session:metadata:session-3": 10,
          "session:metadata:session-4": 300,
          "session:metadata:session-5": 400,
        };
        const ts = map[key];
        return ts === undefined ? null : JSON.stringify({ lastActivity: ts });
      });
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user-123", "session-6");

      expect(mockRedis.srem).toHaveBeenCalledWith("user:sessions:user-123", "session-3");
      expect(mockRedis.del).toHaveBeenCalledWith("session:metadata:session-3");
      expect(markSessionRevoked).toHaveBeenCalledWith("session-3");
    });

    it("handles empty session list", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user-123", "session-1");

      expect(mockRedis.sadd).toHaveBeenCalledWith("user:sessions:user-123", "session-1");
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  describe("revokeUserSession", () => {
    it("removes session from user's session set", async () => {
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);

      await revokeUserSession("user-123", "session-abc");

      expect(mockRedis.srem).toHaveBeenCalledWith("user:sessions:user-123", "session-abc");
      expect(mockRedis.del).toHaveBeenCalledWith("session:metadata:session-abc");
    });
  });

  describe("getUserActiveSessions", () => {
    it("returns empty array when user has no sessions", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);

      const sessions = await getUserActiveSessions("user-123");

      expect(sessions).toEqual([]);
    });

    it("returns sessions with metadata", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["session-1", "session-2"]);
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({
            userAgent: "Chrome/Windows",
            lastActivity: Date.now() - 3600000,
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            userAgent: "Safari/Mac",
            lastActivity: Date.now() - 1800000,
          }),
        );

      const sessions = await getUserActiveSessions("user-123");

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe("session-1");
      expect(sessions[0].deviceInfo).toBe("Chrome/Windows");
      expect(sessions[0].lastActivity).toBeDefined();
      expect(sessions[1].sessionId).toBe("session-2");
      expect(sessions[1].deviceInfo).toBe("Safari/Mac");
    });

    it("skips sessions with missing metadata", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["session-1", "session-2"]);
      mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(
        JSON.stringify({
          userAgent: "Safari/Mac",
          lastActivity: Date.now(),
        }),
      );

      const sessions = await getUserActiveSessions("user-123");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("session-2");
    });

    it("handles invalid metadata gracefully", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["session-1"]);
      mockRedis.get.mockResolvedValueOnce("invalid json");

      const sessions = await getUserActiveSessions("user-123");

      expect(sessions).toHaveLength(0);
    });
  });
});