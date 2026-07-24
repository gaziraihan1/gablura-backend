import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { generateTestToken } from "../helpers/auth.js";
import { generateTestCsrfToken } from "../helpers/csrf.js";
import { createUser } from "../factories/index.js";

/**
 * Why we use generateTestCsrfToken (from helpers/csrf.ts) instead of the
 * production generateCsrfToken (from middleware/csrf.ts):
 *
 * - Production generateCsrfToken stores tokens in Redis. Without a real Redis
 *   connection in tests, it silently skips storage, so validateCsrfToken can
 *   never find the token and either fails or bypasses validation entirely.
 *
 * - generateTestCsrfToken stores tokens in global._testCsrfTokens (in-memory),
 *   which the patched validateCsrfToken (via ENFORCE_CSRF_IN_TESTS) checks as
 *   a fallback — giving us real CSRF validation without Redis.
 *
 * The session ID must match exactly between token generation and the JWT,
 * because the CSRF key is keyed as `csrf:{userId}:{sessionId}`.
 */

describe("CSRF Protection", () => {
  let authToken: string;
  let userId: string;
  let csrfToken: string;
  const sessionId = "test-session-csrf";

  beforeEach(async () => {
    // Signal to validateCsrfToken to enforce real validation (not skip in dev)
    process.env.ENFORCE_CSRF_IN_TESTS = "true";

    const user = await createUser();
    userId = user.id;

    // JWT must carry the same sessionId used to key the CSRF token
    authToken = generateTestToken(
      { id: user.id, email: user.email, role: user.role },
      { sessionId },
    );

    // Store token in global._testCsrfTokens under csrf:{userId}:{sessionId}
    csrfToken = await generateTestCsrfToken(userId, sessionId);
  });

  afterAll(() => {
    delete process.env.ENFORCE_CSRF_IN_TESTS;
  });

  it("should reject POST without CSRF token → 403 CSRF_VALIDATION_FAILED", async () => {
    const response = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Test Task" });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_VALIDATION_FAILED");
  });

  it("should accept POST with valid CSRF token → not 403", async () => {
    const response = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Test Task" });

    expect(response.status).not.toBe(403);
  });

  it("should allow GET requests without CSRF token → not 403", async () => {
    const response = await request(app)
      .get("/api/v1/tasks")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).not.toBe(403);
  });

  it("should reject POST with wrong CSRF token → 403 CSRF_VALIDATION_FAILED", async () => {
    const response = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .set("x-csrf-token", "not-the-right-token")
      .send({ title: "Test Task" });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_VALIDATION_FAILED");
  });

  it("should reject POST with CSRF token belonging to a different session → 403", async () => {
    // Generate a valid token but for a different sessionId
    const wrongSessionToken = await generateTestCsrfToken(
      userId,
      "other-session",
    );

    const response = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .set("x-csrf-token", wrongSessionToken)
      .send({ title: "Test Task" });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_VALIDATION_FAILED");
  });

  it("should skip CSRF validation for /integrations/callback (OAuth callback)", async () => {
    // The callback endpoint uses its own OAuth state-based CSRF token,
    // so the middleware CSRF check must be skipped.
    // We send an intentionally missing/wrong CSRF token — if CSRF were enforced,
    // this would return 403. Instead it should pass through to the route handler
    // (which will fail with a validation error about missing params, NOT 403).
    const response = await request(app)
      .post("/api/v1/user/integrations/callback")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ code: "fake-code", state: "fake-state" });

    // Should NOT be 403 CSRF — it passes CSRF and reaches the route handler,
    // which returns a validation error (400) because the state/code are invalid.
    expect(response.status).not.toBe(403);
    expect(response.body.code).not.toBe("CSRF_VALIDATION_FAILED");
  });
});
