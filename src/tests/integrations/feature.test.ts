// src/tests/integration/feature/feature.test.ts
// Tests FeatureRequest CRUD + FeatureVote idempotency
// Schema: FeatureVote has @@unique([userId, featureRequestId]) — vote twice = upsert

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser, createFeatureRequest } from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders } from "../helpers/auth.js";
import { VoteType, FeatureStatus } from "@prisma/client";

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/features  —  Create feature request
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/features", () => {
  it("201 — any authenticated user can submit a feature request", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/features")
      .set(await authWithCsrfHeaders(user))
      .send({
        title: "Dark mode support",
        description: "Please add a dark mode option to the dashboard.",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe("Dark mode support");
    expect(res.body.data.status).toBe(FeatureStatus.PENDING);

    const feature = await prisma.featureRequest.findUnique({
      where: { id: res.body.data.id },
    });
    expect(feature?.createdById).toBe(user.id);
  });

  it("400 — missing title", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/features")
      .set(await authWithCsrfHeaders(user))
      .send({ description: "No title provided" });

    expect(res.status).toBe(400);
  });

  it("400 — missing description", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/features")
      .set(await authWithCsrfHeaders(user))
      .send({ title: "Feature with no description" });

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app)
      .post("/api/v1/features")
      .send({ title: "No auth", description: "Should fail" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/features  —  List feature requests
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/features", () => {
  it("200 — returns list of feature requests", async () => {
    const user = await createUser();
    await createFeatureRequest(user.id, { title: "Feature A" });
    await createFeatureRequest(user.id, { title: "Feature B" });

    const res = await request(app)
      .get("/api/v1/features")
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const features = res.body.data ?? res.body;
    expect(Array.isArray(features)).toBe(true);
    expect(features.length).toBeGreaterThanOrEqual(2);
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/v1/features");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/features/:featureId/vote  —  Voting (idempotency critical)
// Schema: @@unique([userId, featureRequestId]) — one vote per user per feature
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/features/:featureId/vote", () => {
  it("200/201 — user can upvote a feature", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    const res = await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.UP });

    expect([200, 201]).toContain(res.status);

    const vote = await prisma.featureVote.findUnique({
      where: {
        userId_featureRequestId: {
          userId: user.id,
          featureRequestId: feature.id,
        },
      },
    });
    expect(vote?.type).toBe(VoteType.UP);
  });

  it("200/201 — upvoting twice is idempotent (no duplicate error)", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    // First vote
    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.UP });

    // Second vote — should upsert, not throw 500
    const res = await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.UP });

    expect([200, 201]).toContain(res.status);

    // Still only one vote record
    const votes = await prisma.featureVote.findMany({
      where: { userId: user.id, featureRequestId: feature.id },
    });
    expect(votes).toHaveLength(1);
  });

  it("200/201 — user can change vote from UP to DOWN", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.UP });

    const res = await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.DOWN });

    expect([200, 201]).toContain(res.status);

    const vote = await prisma.featureVote.findUnique({
      where: {
        userId_featureRequestId: {
          userId: user.id,
          featureRequestId: feature.id,
        },
      },
    });
    expect(vote?.type).toBe(VoteType.DOWN);
  });

  it("200/201 — multiple different users can vote on same feature", async () => {
    const creator = await createUser();
    const voter1 = await createUser();
    const voter2 = await createUser();
    const feature = await createFeatureRequest(creator.id);

    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(voter1))
      .send({ type: VoteType.UP });

    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(voter2))
      .send({ type: VoteType.UP });

    const votes = await prisma.featureVote.findMany({
      where: { featureRequestId: feature.id },
    });
    expect(votes).toHaveLength(2);
  });

  it("404 — voting on non-existent feature", async () => {
    const user = await createUser();

    const res = await request(app)
      .post("/api/v1/features/clxxxxxxxxxxxxxxxxxxxxxxxxx/vote")
      .set(await authWithCsrfHeaders(user))
      .send({ type: VoteType.UP });

    expect(res.status).toBe(404);
  });

  it("400 — invalid vote type", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    const res = await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user))
      .send({ type: "SIDEWAYS" }); // not in VoteType enum

    expect(res.status).toBe(400);
  });

  it("401 — unauthenticated cannot vote", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    const res = await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .send({ type: VoteType.UP });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/features/:featureId/vote  —  Remove vote
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/features/:featureId", () => {
  it("200 — user can remove their vote", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    // First cast a vote
    await prisma.featureVote.create({
      data: {
        userId: user.id,
        featureRequestId: feature.id,
        type: VoteType.UP,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const vote = await prisma.featureVote.findUnique({
      where: {
        userId_featureRequestId: {
          userId: user.id,
          featureRequestId: feature.id,
        },
      },
    });
    expect(vote).toBeNull();
  });

  it("404 — removing a vote that does not exist", async () => {
    const user = await createUser();
    const feature = await createFeatureRequest(user.id);

    const res = await request(app)
      .delete(`/api/v1/features/${feature.id}/vote`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });
});
