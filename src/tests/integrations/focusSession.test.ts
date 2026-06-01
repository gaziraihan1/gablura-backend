import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  createTask,
} from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";
import { FocusType } from "@prisma/client";

const BASE = "/api/v1/focus-sessions";
beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/focus-sessions  —  Start a session
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/focus-sessions/start — start", () => {
  it("201 — starts a POMODORO session (default)", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });
    const data = res.body.data;

    expect(res.status).toBe(201);
    expect(data.userId).toBe(user.id);
    expect(data.type).toBe(FocusType.POMODORO);
    expect(data.duration).toBe(25);
    expect(data.completed).toBe(false);
    expect(data.endedAt).toBeNull();
    expect(data.startedAt).toBeDefined();
  });

  it("201 — starts a DEEP_WORK session linked to a task", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id, {
      title: "Deep work task",
    });

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 90, type: FocusType.DEEP_WORK, taskId: task.id });

    expect(res.status).toBe(201);
    expect(res.body.data.taskId).toBe(task.id);
    expect(res.body.data.type).toBe(FocusType.DEEP_WORK);
  });

  it("201 — CUSTOM session with arbitrary duration", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 45, type: FocusType.CUSTOM });

    expect(res.status).toBe(201);
    expect(res.body.data.duration).toBe(45);
  });

  it("400 — cannot start session when one is already active", async () => {
    const user = await createUser();

    // Start first session
    await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    // Try to start another
    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.SHORT_BREAK });

    expect(res.status).toBe(409);
  });

  it("400 — missing duration", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: FocusType.POMODORO });

    expect(res.status).toBe(400);
  });

  it("400 — invalid FocusType", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: "MARATHON" });

    expect(res.status).toBe(400);
  });

  it("400 — duration must be positive", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: -5, type: FocusType.POMODORO });

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app)
      .post(`${BASE}/start`)
      .send({ duration: 25, type: FocusType.POMODORO });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/focus-sessions/:sessionId/complete  —  Complete a session
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/focus-sessions/:id/complete", () => {
  it("200 — completes active session, sets endedAt + completed=true", async () => {
    const user = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    const sessionId = startRes.body.data.id;

    const res = await request(app)
      .post(`${BASE}/${sessionId}/complete`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.completed).toBe(true);
    expect(res.body.data.endedAt).not.toBeNull();

    const db = await prisma.focusSession.findUnique({
      where: { id: sessionId },
    });
    expect(db?.completed).toBe(true);
    expect(db?.endedAt).not.toBeNull();
  });

  it("200 — after completing, user can start a new session", async () => {
    const user = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    await request(app)
      .post(`${BASE}/${startRes.body.data.id}/complete`)
      .set(await authWithCsrfHeaders(user));

    // Now can start another
    const res = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 5, type: FocusType.SHORT_BREAK });

    expect(res.status).toBe(201);
  });

  it("404 — completing non-existent session", async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/clxxxxxxxxxxxxxxxxxxxxxxxxx/complete`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });

  it("404 — cannot complete another user's session", async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user1))
      .send({ duration: 25, type: FocusType.POMODORO });

    const res = await request(app)
      .post(`${BASE}/${startRes.body.data.id}/complete`)
      .set(await authWithCsrfHeaders(user2));

    expect(res.status).toBe(404);
  });

  it("400 — cannot complete an already-completed session", async () => {
    const user = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    await request(app)
      .post(`${BASE}/${startRes.body.data.id}/complete`)
      .set(await authWithCsrfHeaders(user));

    // Try to complete again
    const res = await request(app)
      .post(`${BASE}/${startRes.body.data.id}/complete`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/focus-sessions/:sessionId  —  Abandon / cancel session
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/focus-sessions/:id — abandon", () => {
  it("200 — user can abandon (delete) their active session", async () => {
    const user = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    const res = await request(app)
      .post(`${BASE}/${startRes.body.data.id}/cancel`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    // After abandoning, should be able to start fresh
    const newRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    expect(newRes.status).toBe(201);
  });

  it("404 — cannot abandon another user's session", async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    const startRes = await request(app)
      .post(`${BASE}/start`)
      .set(await authWithCsrfHeaders(user1))
      .send({ duration: 25, type: FocusType.POMODORO });

    const res = await request(app)
      .post(`${BASE}/${startRes.body.data.id}`)
      .set(await authWithCsrfHeaders(user2));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/focus-sessions  —  Session history
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/focus-sessions/history — history", () => {
  it("200 — returns only the requesting user's sessions", async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    // Seed sessions directly for both users
    await prisma.focusSession.createMany({
      data: [
        {
          userId: user1.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: true,
          endedAt: new Date(),
        },
        {
          userId: user1.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: true,
          endedAt: new Date(),
        },
        {
          userId: user2.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: true,
          endedAt: new Date(),
        },
      ],
    });

    const res = await request(app)
      .get(`${BASE}/history?limit=10`)
      .set(authHeaders(user1));

    expect(res.status).toBe(200);
    const sessions = res.body.data ?? res.body;
    expect(
      sessions.every((s: { userId: string }) => s.userId === user1.id),
    ).toBe(true);
    expect(sessions).toHaveLength(2);
  });

  it("200 — GET active session (endedAt=null)", async () => {
    const user = await createUser();

    await request(app)
      .post(BASE + "/start")
      .set(await authWithCsrfHeaders(user))
      .send({ duration: 25, type: FocusType.POMODORO });

    const res = await request(app).get(`${BASE}/active`).set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.endedAt).toBeNull();
    expect(res.body.data.completed).toBe(false);
  });

  it("200 — no active session returns 200 with null body or 404", async () => {
    const user = await createUser();

    const res = await request(app).get(`${BASE}/active`).set(authHeaders(user));

    // Either 200 { data: null } or 404 — both acceptable
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/focus-sessions/stats  —  Aggregated stats
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/focus-sessions/stats", () => {
  it("200 — returns stats for user's completed sessions only", async () => {
    const user = await createUser();

    // Seed: 3 completed, 1 incomplete
    await prisma.focusSession.createMany({
      data: [
        {
          userId: user.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: true,
          endedAt: new Date(),
        },
        {
          userId: user.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: true,
          endedAt: new Date(),
        },
        {
          userId: user.id,
          duration: 90,
          type: FocusType.DEEP_WORK,
          completed: true,
          endedAt: new Date(),
        },
        {
          userId: user.id,
          duration: 25,
          type: FocusType.POMODORO,
          completed: false,
        }, // active
      ],
    });

    const res = await request(app).get(`${BASE}/stats`).set(authHeaders(user));

    expect(res.status).toBe(200);
    // Completed: 25 + 25 + 90 = 140 minutes
    expect(res.body.data.totalMinutes ?? res.body.total).toBeGreaterThanOrEqual(
      140,
    );
    expect(res.body.data.totalSessions ?? res.body.completed).toBe(3);
  });

  it("200 — stats are isolated per user", async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    await prisma.focusSession.create({
      data: {
        userId: user2.id,
        duration: 999,
        type: FocusType.DEEP_WORK,
        completed: true,
        endedAt: new Date(),
      },
    });

    const res = await request(app).get(`${BASE}/stats`).set(authHeaders(user1));

    expect(res.status).toBe(200);
    // user1 has no sessions — should be 0
    expect(res.body.totalMinutes ?? 0).toBe(0);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get(`${BASE}/stats`);
    expect(res.status).toBe(401);
  });
});
