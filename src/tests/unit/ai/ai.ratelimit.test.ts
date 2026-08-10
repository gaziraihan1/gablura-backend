import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../../middleware/auth.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Hoisted mocks
// ═══════════════════════════════════════════════════════════════════════════════

const mockPrisma = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
}));

const mockBillingService = vi.hoisted(() => ({
  getUserHighestPlan: vi.fn(),
}));

const mockGetRedisClient = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../../modules/billing/billing.service.js", () => ({
  BillingService: mockBillingService,
}));
vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: mockGetRedisClient,
}));

// ═══════════════════════════════════════════════════════════════════════════════

import {
  aiRateLimit,
  getAiScope,
  resolveUserPlan,
  resolveWorkspacePlan,
} from "../../../modules/ai/ai.ratelimit.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

interface RedisMock {
  pipeline: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  _pipeObj: {
    zremrangebyscore: ReturnType<typeof vi.fn>;
    zadd: ReturnType<typeof vi.fn>;
    zcard: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };
  _execResults: Array<[Error | null, unknown]>;
}

function createRedisMock(overrides: Partial<RedisMock> = {}): RedisMock {
  const execResults: Array<[Error | null, unknown]> = [];
  const pipeObj = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(execResults),
  };
  return {
    pipeline: vi.fn().mockReturnValue(pipeObj),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    _pipeObj: pipeObj,
    _execResults: execResults,
    ...overrides,
  };
}

function createReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    user: { id: "user-1", email: "a@b.com", role: "USER" },
    ...overrides,
  } as unknown as AuthRequest;
}

function createRes(): Response {
  const res = {
    locals: {} as Record<string, unknown>,
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next = vi.fn() as NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Plan resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveWorkspacePlan", () => {
  it("returns FREE when the workspace does not exist", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue(null);
    await expect(resolveWorkspacePlan("missing-ws")).resolves.toBe("FREE");
  });

  it("returns the workspace plan when found", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "PRO" });
    await expect(resolveWorkspacePlan("ws-1")).resolves.toBe("PRO");
  });

  it("falls back to FREE for unknown plans", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "MYSTERY" });
    await expect(resolveWorkspacePlan("ws-unknown")).resolves.toBe("FREE");
  });

  it("caches plan lookups for 60s", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });
    await resolveWorkspacePlan("ws-cached");
    await resolveWorkspacePlan("ws-cached");
    expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("resolveUserPlan", () => {
  it("delegates to the billing service highest plan", async () => {
    mockBillingService.getUserHighestPlan.mockResolvedValue("PRO");
    await expect(resolveUserPlan("user-1")).resolves.toBe("PRO");
  });

  it("falls back to FREE for unknown plans", async () => {
    mockBillingService.getUserHighestPlan.mockResolvedValue("MYSTERY");
    await expect(resolveUserPlan("user-1")).resolves.toBe("FREE");
  });
});

describe("getAiScope", () => {
  it("scopes to the workspace when workspaceId is in the body", () => {
    const scope = getAiScope(createReq({ body: { workspaceId: "ws-1" } }));
    expect(scope).toEqual({ id: "ws:ws-1", workspaceId: "ws-1" });
  });

  it("scopes to the workspace when workspaceId is a query param", () => {
    const scope = getAiScope(createReq({ query: { workspaceId: "ws-2" } }));
    expect(scope).toEqual({ id: "ws:ws-2", workspaceId: "ws-2" });
  });

  it("scopes to the user when workspaceId is absent", () => {
    const scope = getAiScope(createReq());
    expect(scope).toEqual({ id: "usr:user-1" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// aiRateLimit middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe("aiRateLimit", () => {
  it("allows requests under the limits and sets quota headers", async () => {
    const redis = createRedisMock();
    redis._execResults.push([null, 0]); // zremrangebyscore
    redis._execResults.push([null, 1]); // zadd
    redis._execResults.push([null, 1]); // zcard burst = 1
    redis._execResults.push([null, 1]); // expire
    redis._execResults.push([null, 0]); // zremrangebyscore
    redis._execResults.push([null, 1]); // zadd
    redis._execResults.push([null, 1]); // zcard hourly = 1
    redis._execResults.push([null, 1]); // expire
    mockGetRedisClient.mockReturnValue(redis);
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "PRO" });

    const req = createReq({ body: { workspaceId: "ws-ok" } });
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("X-AI-RateLimit-Plan", "PRO");
    expect(res.setHeader).toHaveBeenCalledWith("X-AI-RateLimit-Limit", "300");
    expect(res.setHeader).toHaveBeenCalledWith("X-AI-RateLimit-Remaining", "299");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 AI_RATE_LIMIT_EXCEEDED when the burst window is exceeded", async () => {
    const redis = createRedisMock();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 4]); // burst = 4 > FREE limit of 3
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    const req = createReq({ body: { workspaceId: "ws-burst" } });
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "AI_RATE_LIMIT_EXCEEDED",
        plan: "FREE",
        retryAfter: 60,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 AI_DAILY_QUOTA_EXCEEDED when the daily quota is exhausted", async () => {
    const redis = createRedisMock();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]); // burst ok
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]); // hourly ok
    redis._execResults.push([null, 1]);
    redis.incr.mockResolvedValue(61); // FREE daily = 60
    mockGetRedisClient.mockReturnValue(redis);
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    const req = createReq({ body: { workspaceId: "ws-daily" } });
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "AI_DAILY_QUOTA_EXCEEDED",
        retryAfter: 3600,
      }),
    );
    // The client builds the upgrade URL from the workspace slug — the response
    // must not point at the personal settings page.
    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ upgradeUrl: expect.anything() }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("scopes to the user plan for personal (workspace-less) requests", async () => {
    const redis = createRedisMock();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);
    mockBillingService.getUserHighestPlan.mockResolvedValue("PRO");

    const req = createReq(); // no workspaceId
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(mockBillingService.getUserHighestPlan).toHaveBeenCalledWith("user-1");
    expect(res.setHeader).toHaveBeenCalledWith("X-AI-RateLimit-Plan", "PRO");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails closed with AI_RATE_LIMIT_SERVICE_UNAVAILABLE on Redis errors", async () => {
    mockGetRedisClient.mockImplementation(() => {
      throw new Error("Redis connection failed");
    });
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    const req = createReq({ body: { workspaceId: "ws-down" } });
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "AI_RATE_LIMIT_SERVICE_UNAVAILABLE",
        retryAfter: 60,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("survives a null pipeline exec (treats count as 0)", async () => {
    const redis = createRedisMock();
    redis._pipeObj.exec.mockResolvedValue(null);
    mockGetRedisClient.mockReturnValue(redis);
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    const req = createReq({ body: { workspaceId: "ws-null" } });
    const res = createRes();

    await aiRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
