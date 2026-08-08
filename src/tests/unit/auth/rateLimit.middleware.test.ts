import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction } from "express";

const mockRedis = {
  pipeline: vi.fn(),
};

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

import { rateLimitMiddleware } from "../../../middleware/rateLimiter.js";

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

function pipelineWithCount(count: number) {
  return {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, count],
      [null, 1],
    ]),
  };
}

describe("rateLimitMiddleware (used on 2FA endpoints)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through when under the limit", async () => {
    mockRedis.pipeline.mockReturnValue(pipelineWithCount(3));
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await rateLimitMiddleware(10, 60)({ headers: {}, ip: "127.0.0.1" } as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("rejects with 429 when the limit is exceeded (TOTP brute-force throttle)", async () => {
    mockRedis.pipeline.mockReturnValue(pipelineWithCount(11));
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await rateLimitMiddleware(10, 60)({ headers: {}, ip: "127.0.0.1" } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("fails closed (429) when redis is unavailable", async () => {
    mockRedis.pipeline.mockImplementation(() => {
      throw new Error("redis down");
    });
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await rateLimitMiddleware(10, 60)({ headers: {}, ip: "127.0.0.1" } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("RATE_LIMIT_SERVICE_UNAVAILABLE");
  });

  it("throttles per-user when keyFn is provided (2FA per-user brute-force guard)", async () => {
    mockRedis.pipeline.mockReturnValue(pipelineWithCount(11));
    const next: NextFunction = vi.fn();
    const res = makeRes();
    await rateLimitMiddleware(10, 60, (r: any) => r.user?.id)(
      { headers: {}, ip: "127.0.0.1", user: { id: "user-123" } } as any,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
    const zaddMock = (mockRedis.pipeline.mock.results[0].value.zadd as any).mock.calls;
    expect(zaddMock[0][0]).toBe("rl:user:user-123");
  });

  it("keeps separate buckets per user id (user A never consumes user B's quota)", async () => {
    mockRedis.pipeline.mockReturnValue(pipelineWithCount(1));
    const nextA: NextFunction = vi.fn();
    const resA = makeRes();
    await rateLimitMiddleware(10, 60, (r: any) => r.user?.id)(
      { headers: {}, ip: "127.0.0.1", user: { id: "user-a" } } as any,
      resA,
      nextA,
    );
    const keyA = (mockRedis.pipeline.mock.results[0].value.zadd as any).mock.calls[0][0];

    mockRedis.pipeline.mockReturnValue(pipelineWithCount(1));
    const nextB: NextFunction = vi.fn();
    const resB = makeRes();
    await rateLimitMiddleware(10, 60, (r: any) => r.user?.id)(
      { headers: {}, ip: "127.0.0.1", user: { id: "user-b" } } as any,
      resB,
      nextB,
    );
    const keyB = (mockRedis.pipeline.mock.results[mockRedis.pipeline.mock.results.length - 1].value.zadd as any).mock.calls[0][0];

    expect(keyA).toBe("rl:user:user-a");
    expect(keyB).toBe("rl:user:user-b");
    expect(keyA).not.toBe(keyB);
  });
});
