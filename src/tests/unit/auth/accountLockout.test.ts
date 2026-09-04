import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    pipeline: vi.fn(() => ({
      incr: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(),
    })),
  })),
}));

import {
  recordFailedAttempt,
  clearFailedAttempts,
  isAccountLocked,
} from "../../../lib/auth/accountLockout.js";
import { getRedisClient } from "../../../redis/redis.client.js";

describe("accountLockout", () => {
  const mockRedis = {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    pipeline: vi.fn(() => ({
      incr: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as any);
  });

  describe("recordFailedAttempt", () => {
    it("returns locked: true when account is already locked", async () => {
      const lockTimestamp = Date.now() + 900000; // 15 minutes from now
      mockRedis.get.mockResolvedValueOnce(String(lockTimestamp));

      const result = await recordFailedAttempt("user@example.com");

      expect(result.locked).toBe(true);
      expect(result.unlocksAt).toEqual(new Date(lockTimestamp));
      expect(result.attempts).toBe(10);
    });

    it("increments failure count and returns locked: false below threshold", async () => {
      mockRedis.get.mockResolvedValueOnce(null); // No existing lock
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue([[null, 5]]),
      } as any);

      const result = await recordFailedAttempt("user@example.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(5);
    });

    it("locks account when failure count reaches threshold", async () => {
      mockRedis.get.mockResolvedValueOnce(null); // No existing lock
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue([[null, 10]]),
      } as any);
      mockRedis.setex.mockResolvedValue("OK");

      const result = await recordFailedAttempt("user@example.com");

      expect(result.locked).toBe(true);
      expect(result.attempts).toBe(10);
      expect(result.unlocksAt).toBeInstanceOf(Date);
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it("handles pipeline exec returning null gracefully", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const result = await recordFailedAttempt("user@example.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(1);
    });
  });

  describe("clearFailedAttempts", () => {
    it("deletes both failure and lock keys", async () => {
      mockRedis.del.mockResolvedValue(2);

      await clearFailedAttempts("user@example.com");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "gablura:lockout:failures:user@example.com",
        "gablura:lockout:locked:user@example.com"
      );
    });
  });

  describe("isAccountLocked", () => {
    it("returns locked: false when no lock exists", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await isAccountLocked("user@example.com");

      expect(result.locked).toBe(false);
      expect(result.unlocksAt).toBeUndefined();
    });

    it("returns locked: true with unlock time when lock exists", async () => {
      const lockTimestamp = Date.now() + 900000;
      mockRedis.get.mockResolvedValueOnce(String(lockTimestamp));

      const result = await isAccountLocked("user@example.com");

      expect(result.locked).toBe(true);
      expect(result.unlocksAt).toEqual(new Date(lockTimestamp));
    });
  });
});