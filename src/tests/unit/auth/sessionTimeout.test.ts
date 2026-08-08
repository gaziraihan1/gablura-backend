import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction } from "express";

// In-memory store shared by the mocked redis client
const store = new Map<string, string>();
const mockRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (store.delete(k)) n++;
    return n;
  }),
  exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
};

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

import {
  sessionTimeout,
  recordSessionCreation,
} from "../../../middleware/sessionTimeout.js";

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe("sessionTimeout middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
  });

  it("passes through when there is no sessionId", async () => {
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await sessionTimeout({ user: {} } as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("passes through for untracked (legacy) sessions", async () => {
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await sessionTimeout(
      { user: { sessionId: "never-recorded" } } as any,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("passes through for a tracked, active session and refreshes activity", async () => {
    await recordSessionCreation("session-1");
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await sessionTimeout({ user: { sessionId: "session-1" } } as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
    // activity key was re-armed
    expect(mockRedis.setex).toHaveBeenCalledWith(
      "session:activity:session-1",
      expect.any(Number),
      expect.any(String),
    );
  });

  it("rejects a tracked session whose activity key expired (inactivity timeout)", async () => {
    await recordSessionCreation("session-1");
    await mockRedis.del("session:activity:session-1");
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await sessionTimeout({ user: { sessionId: "session-1" } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("SESSION_TIMEOUT");
  });
});
