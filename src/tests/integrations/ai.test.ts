// src/tests/integrations/ai.test.ts
// Verifies the /api/v1/ai wiring: graceful 503 when Gemini is unconfigured,
// validation, quota reads and workspace-membership enforcement.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { WorkspaceRole } from "@prisma/client";
import app from "../../app.js";
import {
  addMemberToWorkspace,
  createMeeting,
  createUser,
  createWorkspaceWithOwner,
} from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/tasks/autocomplete
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/ai/tasks/autocomplete", () => {
  it("503 AI_SERVICE_UNAVAILABLE when Gemini is not configured (graceful)", async () => {
    // Integration tests never have GEMINI_API_KEY — the service must degrade
    // with a structured 503 instead of a 500 or a crash.
    delete process.env.GEMINI_API_KEY;

    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/tasks/autocomplete")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Fix login redirect on mobile" });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("AI_SERVICE_UNAVAILABLE");
  });

  it("400 validation error for a too-short title", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/tasks/autocomplete")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "ab" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("429 AI_MONTHLY_QUOTA_EXCEEDED when the monthly token budget is exhausted", async () => {
    // The pre-check fires before any provider call, so a fake key is enough.
    process.env.GEMINI_API_KEY = "test-key";
    try {
      const user = await createUser();
      const { getRedisClient } = await import("../../redis/redis.client.js");
      const month = new Date().toISOString().slice(0, 7);
      // FREE personal budget is 500k/month — seed just under so any call trips it.
      await getRedisClient().set(
        `focura:ai:q:tokens:month:${month}:usr:${user.id}`,
        "499999",
      );

      const res = await request(app)
        .post("/api/v1/ai/tasks/autocomplete")
        .set(await authWithCsrfHeaders(user))
        .send({ title: "Fix login redirect on mobile" });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("AI_MONTHLY_QUOTA_EXCEEDED");
      expect(res.body.retryAfter).toEqual(expect.any(Number));
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("401 without an auth token", async () => {
    const res = await request(app)
      .post("/api/v1/ai/tasks/autocomplete")
      .send({ title: "Fix login redirect on mobile" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/plan/daily
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/ai/plan/daily", () => {
  it("503 AI_SERVICE_UNAVAILABLE when Gemini is not configured (graceful)", async () => {
    delete process.env.GEMINI_API_KEY;
    // plan.daily needs a PRO+ plan — FREE would 403 on the feature gate first.
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "PRO" },
    );

    const res = await request(app)
      .post("/api/v1/ai/plan/daily")
      .set(await authWithCsrfHeaders(user))
      .send({
        workspaceId: workspace.id,
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "Fix login bug" }],
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_SERVICE_UNAVAILABLE");
  });

  it("400 validation error for an empty task list", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/plan/daily")
      .set(await authWithCsrfHeaders(user))
      .send({ date: "2026-08-10", tasks: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("403 AI_FEATURE_NOT_AVAILABLE for a FREE plan user", async () => {
    const { user } = await createWorkspaceWithOwner({}, { plan: "FREE" });

    const res = await request(app)
      .post("/api/v1/ai/plan/daily")
      .set(await authWithCsrfHeaders(user))
      .send({
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "Fix login bug" }],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_FEATURE_NOT_AVAILABLE");
  });

  it("403 for a non-member probing a workspace plan", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/plan/daily")
      .set(await authWithCsrfHeaders(outsider))
      .send({
        workspaceId: workspace.id,
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "Fix login bug" }],
      });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/meetings/summarize
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/ai/meetings/summarize", () => {
  it("503 AI_SERVICE_UNAVAILABLE when Gemini is not configured (graceful)", async () => {
    delete process.env.GEMINI_API_KEY;
    // meetings.summarize needs a PRO+ plan — FREE would 403 on the feature gate first.
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "PRO" },
    );
    const meeting = await createMeeting(workspace.id, user.id);

    const res = await request(app)
      .post("/api/v1/ai/meetings/summarize")
      .set(await authWithCsrfHeaders(user))
      .send({ workspaceId: workspace.id, meetingId: meeting.id });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_SERVICE_UNAVAILABLE");
  });

  it("400 validation error when meetingId is missing", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/meetings/summarize")
      .set(await authWithCsrfHeaders(user))
      .send({ notes: "no meeting" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("403 AI_FEATURE_NOT_AVAILABLE for a FREE plan user", async () => {
    const { user } = await createWorkspaceWithOwner({}, { plan: "FREE" });

    const res = await request(app)
      .post("/api/v1/ai/meetings/summarize")
      .set(await authWithCsrfHeaders(user))
      .send({ meetingId: "m1" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_FEATURE_NOT_AVAILABLE");
  });

  it("403 for a non-member probing a workspace meeting", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/meetings/summarize")
      .set(await authWithCsrfHeaders(outsider))
      .send({ workspaceId: workspace.id, meetingId: "m1" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/insights/weekly
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/ai/insights/weekly", () => {
  it("503 AI_SERVICE_UNAVAILABLE when Gemini is not configured (graceful)", async () => {
    delete process.env.GEMINI_API_KEY;
    // insights.weekly is BUSINESS-only — FREE/PRO would 403 on the feature gate first.
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "BUSINESS" },
    );

    const res = await request(app)
      .post("/api/v1/ai/insights/weekly")
      .set(await authWithCsrfHeaders(user))
      .send({ workspaceId: workspace.id, week: "2026-08-03" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_SERVICE_UNAVAILABLE");
  });

  it("400 validation error when workspaceId is missing", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/insights/weekly")
      .set(await authWithCsrfHeaders(user))
      .send({ week: "2026-08-03" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("403 AI_FEATURE_NOT_AVAILABLE for a PRO plan user (BUSINESS-only)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "PRO" },
    );

    const res = await request(app)
      .post("/api/v1/ai/insights/weekly")
      .set(await authWithCsrfHeaders(user))
      .send({ workspaceId: workspace.id, week: "2026-08-03" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_FEATURE_NOT_AVAILABLE");
  });

  it("403 for a non-member probing a workspace insight", async () => {
    const { workspace } = await createWorkspaceWithOwner({}, { plan: "BUSINESS" });
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/insights/weekly")
      .set(await authWithCsrfHeaders(outsider))
      .send({ workspaceId: workspace.id, week: "2026-08-03" });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/usage (OWNER/ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/ai/usage", () => {
  it("400 when workspaceId is missing", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/api/v1/ai/usage")
      .set(await authHeaders(user));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("200 for a workspace owner (empty report when no usage yet)", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "PRO" },
    );

    const res = await request(app)
      .get(`/api/v1/ai/usage?workspaceId=${workspace.id}`)
      .set(await authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      workspaceId: workspace.id,
      days: 30,
      total: { calls: 0, totalTokens: 0, costUsd: 0 },
      byFeature: [],
      byModel: [],
      recent: [],
    });
  });

  it("200 for a workspace admin", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .get(`/api/v1/ai/usage?workspaceId=${workspace.id}`)
      .set(await authHeaders(admin));

    expect(res.status).toBe(200);
  });

  it("403 for a regular member", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(`/api/v1/ai/usage?workspaceId=${workspace.id}`)
      .set(await authHeaders(member));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("403 for a non-member probing a workspace", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/ai/usage?workspaceId=${workspace.id}`)
      .set(await authHeaders(outsider));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/quota
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/ai/quota", () => {
  it("200 personal quota for any authenticated user", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/api/v1/ai/quota")
      .set(await authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      plan: "FREE",
      dailyLimit: expect.any(Number),
      remaining: expect.any(Number),
    });
    expect(res.body.data.features).toContain("tasks.autocomplete");
  });

  it("200 workspace quota for a workspace member", async () => {
    const { user, workspace } = await createWorkspaceWithOwner(
      {},
      { plan: "PRO" },
    );

    const res = await request(app)
      .get(`/api/v1/ai/quota?workspaceId=${workspace.id}`)
      .set(await authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe("PRO");
  });

  it("403 for a non-member probing a workspace quota", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/v1/ai/quota?workspaceId=${workspace.id}`)
      .set(await authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it("403 for a non-member calling a workspace-scoped feature", async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post("/api/v1/ai/tasks/autocomplete")
      .set(await authWithCsrfHeaders(outsider))
      .send({ workspaceId: workspace.id, title: "Fix login redirect" });

    expect(res.status).toBe(403);
  });

});
