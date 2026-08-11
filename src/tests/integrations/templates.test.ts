// templates.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser, createAdminUser } from "../factories/index.js";
import { authHeaders, authWithCsrfHeaders, TestUser } from "../helpers/auth.js";
import { getRedisClient } from "../../redis/redis.client.js";

describe("Templates Module Integration Tests", () => {
  let adminUser: TestUser;

  beforeEach(async () => {
    adminUser = await createAdminUser();
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
      expect(res.body.message).toBe("Validation error");
    });

    it("400 — rejects duplicate emails", async () => {
      const email = `dup-${Date.now()}@example.com`;
      await prisma.templateList.create({ data: { email } });

      const res = await request(app)
        .post("/api/v1/templates")
        .send({ email });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("This email is already on the template waitlist");
    });

    it("429 — enforces rate limiting", async () => {
      const emailBase = `rate-${Date.now()}@example.com`;
      const fixedIp = `test-ip-${Date.now()}`;

      const slidingWindowCounts = new Map<string, number[]>();
      const redis = getRedisClient();
      
      const pipelineSpy = vi.spyOn(redis, "pipeline").mockImplementation(() => {
        let pendingKey: string | null = null;
        let windowBound: number | null = null;

        const pipelineMock = {
          zremrangebyscore: vi.fn((key: string, _min: number, _max: number) => {
            pendingKey = key;
            windowBound = _max;
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
            return [[null, 0], [null, 1], [null, timestamps.length], [null, 1]];
          }),
        };
        return pipelineMock as any;
      });

      try {
        // Exhaust the limit (max = 5)
        for (let i = 0; i < 6; i++) {
          await request(app)
            .post("/api/v1/templates")
            .set("x-forwarded-for", fixedIp)
            .send({ email: `${i}-${emailBase}` });
        }

        const res = await request(app)
          .post("/api/v1/templates")
          .set("x-forwarded-for", fixedIp)
          .send({ email: `overflow-${emailBase}` });

        expect(res.status).toBe(429);
        expect(res.body.message).toBe("Too many requests");
      } finally {
        pipelineSpy.mockRestore();
      }
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

      const headers = await authWithCsrfHeaders(adminUser);
      const res = await request(app)
        .delete(`/api/v1/templates/${encodeURIComponent(email)}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Template request removed");

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

});
