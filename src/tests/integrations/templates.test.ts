// templates.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser } from "../factories/index.js";
import { authHeaders, TestUser } from "../helpers/auth.js";
import { getRedisClient } from "../../redis/redis.client.js";

let adminUserId: string;
vi.mock("../../config/admin.config.js", () => ({
  isFocuraAdmin: vi.fn().mockImplementation((userId: string) => userId === adminUserId),
}));

describe("Templates Module Integration Tests", () => {
  let adminUser: TestUser;

  beforeEach(async () => {
    adminUser = await createUser({ role: "ADMIN" });
    adminUserId = adminUser.id;
  });

  describe("POST /api/v1/templates", () => {
    it("200 — allows adding a new email to the template list", async () => {
      const email = `test-template-${Date.now()}@example.com`;
      const res = await request(app)
        .post("/api/v1/templates")
        .send({ email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain(email);

      const dbUser = await prisma.templateList.findUnique({ where: { email } });
      expect(dbUser).toBeDefined();
    });

    it("400 — rejects request without email", async () => {
      const res = await request(app)
        .post("/api/v1/templates")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email is required");
    });

    it("400 — rejects duplicate emails", async () => {
      const email = `dup-${Date.now()}@example.com`;
      await prisma.templateList.create({ data: { email } });

      const res = await request(app)
        .post("/api/v1/templates")
        .send({ email });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email already exists");
    });

    it("429 — enforces rate limiting", async () => {
      const emailBase = `rate-${Date.now()}@example.com`;
      const fixedIp = `test-ip-${Date.now()}`; // Unique IP per test run
      
      // Send a large number of requests to ensure the limit is hit
      // The limit is 5 requests
      for (let i = 0; i < 15; i++) {
        await request(app)
          .post("/api/v1/templates")
          .set("x-forwarded-for", fixedIp)
          .send({ email: `${i}-${emailBase}` });
      }

      const res = await request(app)
        .post("/api/v1/templates")
        .set("x-forwarded-for", fixedIp)
        .send({ email: `overflow-${emailBase}` });

      if (res.status !== 429) {
        console.log("Rate limit failed. Status:", res.status, "Body:", res.body);
      }

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Too many requests");
    });
  });

  describe("Protected Template Routes", () => {
    it("401 — rejects GET /templates without auth", async () => {
      const res = await request(app).get("/api/v1/templates");
      expect(res.status).toBe(401);
    });

    it("200 — allows admin to list templates", async () => {
      const res = await request(app)
        .get("/api/v1/templates")
        .set(authHeaders(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("200 — allows admin to delete a template email", async () => {
      const email = `delete-me-${Date.now()}@example.com`;
      await prisma.templateList.create({ data: { email } });

      const res = await request(app)
        .delete(`/api/v1/templates/${encodeURIComponent(email)}`)
        .set(authHeaders(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Email deleted successfully");

      const dbUser = await prisma.templateList.findUnique({ where: { email } });
      expect(dbUser).toBeNull();
    });

    it("403 — rejects non-admin user from accessing templates", async () => {
      const regularUser = await createUser({ role: "USER" });
      const res = await request(app)
        .get("/api/v1/templates")
        .set(authHeaders(regularUser));

      expect(res.status).toBe(403);
    });
  });
  describe("POST /api/v1/templates", () => {
    it("429 — enforces rate limiting", async () => {
      const emailBase = `rate-${Date.now()}@example.com`;
      const fixedIp = `test-ip-${Date.now()}`;

      // Inject a stateful pipeline that actually counts per key
      const slidingWindowCounts = new Map<string, number[]>();

      const redis = getRedisClient();
      vi.spyOn(redis, "pipeline").mockImplementation(() => {
        let pendingKey: string | null = null;
        let windowBound: number | null = null;

        const pipelineMock = {
          zremrangebyscore: vi.fn((key: string, _min: number, _max: number) => {
            pendingKey = key;
            windowBound = _max; // this is windowStart (now - window*1000)
            return pipelineMock;
          }),
          zadd: vi.fn(() => pipelineMock),
          zcard: vi.fn(() => pipelineMock),
          expire: vi.fn(() => pipelineMock),
          exec: vi.fn(async () => {
            if (!pendingKey) return [[null, 0], [null, 1], [null, 0], [null, 1]];

            const now = Date.now();
            const timestamps = (slidingWindowCounts.get(pendingKey) ?? [])
              .filter((t) => t > (windowBound ?? 0));
            timestamps.push(now);
            slidingWindowCounts.set(pendingKey, timestamps);
            const count = timestamps.length;

            // Mirror the pipeline result shape: [zremrangebyscore, zadd, zcard, expire]
            return [[null, 0], [null, 1], [null, count], [null, 1]];
          }),
        };
        return pipelineMock as any;
      });

      // Exhaust the limit (max = 5)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/v1/templates")
          .set("x-forwarded-for", fixedIp)
          .send({ email: `${i}-${emailBase}` });
      }

      // 6th request — count will be 6 > 5
      const res = await request(app)
        .post("/api/v1/templates")
        .set("x-forwarded-for", fixedIp)
        .send({ email: `overflow-${emailBase}` });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Too many requests");

      // Restore the original mock so other tests are unaffected
      vi.restoreAllMocks();
    });
  });

});
