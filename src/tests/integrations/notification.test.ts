import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser } from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";

const BASE = "/api/v1/notifications";

describe("Notification API", () => {
  beforeEach(() => {
    process.env.ENFORCE_CSRF_IN_TESTS = "true";
  });

  afterAll(() => {
    delete process.env.ENFORCE_CSRF_IN_TESTS;
  });

  it("GET / — should fetch notifications", async () => {
    const user = await createUser();
    await prisma.notification.create({
        data: { userId: user.id, type: "TASK_ASSIGNED", title: "T", message: "M" }
    });

    const res = await request(app)
      .get(`${BASE}/`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBe(1);
  });

  it("POST /:id/read — should mark as read", async () => {
    const user = await createUser();
    const notif = await prisma.notification.create({
        data: { userId: user.id, type: "TASK_ASSIGNED", title: "T", message: "M" }
    });

    const res = await request(app)
      .patch(`${BASE}/${notif.id}/read`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    const updated = await prisma.notification.findUnique({ where: { id: notif.id } });
    expect(updated?.read).toBe(true);
  });
});
