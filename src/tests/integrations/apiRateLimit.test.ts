import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Replace the limiter module so we can force 429s without exhausting real
// buckets. rateLimitUserApi lazy-imports ../lib/limiter.js at request time,
// so these mocks are picked up by the app under test.
const mockLimitApiRequest = vi.hoisted(() => vi.fn());
const mockResolveUserApiTier = vi.hoisted(() => vi.fn());

vi.mock("../../lib/limiter.js", () => ({
  limitApiRequest: (...args: any[]) => mockLimitApiRequest(...args),
  resolveUserApiTier: (...args: any[]) => mockResolveUserApiTier(...args),
}));

import app from "../../app.js";
import { createUser } from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";

describe("rateLimitUserApi on core CRUD routes", () => {
  beforeEach(() => {
    mockLimitApiRequest.mockReset();
    mockResolveUserApiTier.mockReset();
    mockResolveUserApiTier.mockResolvedValue("pro");
  });

  it("rejects with 429 + X-RateLimit headers when the per-user limit is exceeded", async () => {
    const user = await createUser();

    mockLimitApiRequest.mockResolvedValue({
      success: false,
      limit: 300,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    // One representative route per wired module. The limiter runs before the
    // controller, so no fixtures are needed — comments/subtasks are covered
    // via the task router (they are only mounted nested under /api/v1/tasks).
    // Only the upload route is state-changing, so it needs CSRF headers.
    const routes = [
      { method: "get", path: "/api/v1/tasks" },
      { method: "get", path: "/api/v1/tasks/task-1/comments" },
      { method: "get", path: "/api/v1/projects/user/all" },
      { method: "get", path: "/api/v1/workspaces" },
      { method: "get", path: "/api/v1/focus-sessions/active" },
      { method: "get", path: "/api/v1/calendar/aggregates" },
      { method: "get", path: "/api/v1/analytics/ws-1/overview" },
      { method: "get", path: "/api/v1/meetings/ws-1/meetings" },
      { method: "get", path: "/api/v1/labels" },
      { method: "post", path: "/api/v1/upload", csrf: true },
    ];

    for (const route of routes) {
      const headers = route.csrf
        ? await authWithCsrfHeaders(user)
        : authHeaders(user);
      const res = await request(app)
        [route.method as "get" | "post"](route.path)
        .set(headers);

      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(res.headers["x-ratelimit-limit"]).toBe("300");
      expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    }
  });

  it("passes requests through under the limit and resolves the user's billing tier", async () => {
    const user = await createUser();
    const headers = authHeaders(user);

    mockLimitApiRequest.mockResolvedValue({
      success: true,
      limit: 300,
      remaining: 299,
      reset: Date.now() + 60_000,
    });

    const res = await request(app).get("/api/v1/tasks").set(headers);

    expect(res.status).toBe(200);
    expect(mockResolveUserApiTier).toHaveBeenCalledWith(user.id);
    expect(mockLimitApiRequest).toHaveBeenCalledWith(user.id, "pro");
    expect(res.headers["x-ratelimit-limit"]).toBe("300");
  });
});
