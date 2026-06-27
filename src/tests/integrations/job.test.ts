import { describe, it, expect, afterEach, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { vi } from "vitest";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createAdminUser,
  createJobPosting,
} from "../factories/index.js";
import {
  authHeaders,
  authWithCsrfHeaders,
} from "../helpers/auth.js";
import { JobStatus } from "@prisma/client";

type ApiJob = {
  id: string;
  title: string;
  slug: string;
  status: string;
};

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("Public Job Endpoints", () => {
  it("GET /api/v1/jobs — 200 returns open jobs", async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN, title: "Public Job" });
    await createJobPosting(user.id, { status: JobStatus.CLOSED, title: "Hidden Job" });

    const res = await request(app).get("/api/v1/jobs");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].title).toBe("Public Job");
  });

  it("GET /api/v1/jobs — 200 filters by department", async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN, department: "Engineering" });
    await createJobPosting(user.id, { status: JobStatus.OPEN, department: "Sales" });

    const res = await request(app).get("/api/v1/jobs?department=Engineering");

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].department).toBe("Engineering");
  });

  it("GET /api/v1/jobs/:slug — 200 returns job details if open", async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { status: JobStatus.OPEN, title: "Detail Job" });

    const res = await request(app).get(`/api/v1/jobs/${job.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Detail Job");
  });

  it("GET /api/v1/jobs/:slug — 404 if job is closed", async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { status: JobStatus.CLOSED });

    const res = await request(app).get(`/api/v1/jobs/${job.slug}`);

    expect(res.status).toBe(404);
  });

  it("GET /api/v1/jobs/:slug — 404 if not found", async () => {
    const res = await request(app).get("/api/v1/jobs/non-existent-slug");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin Job Endpoints", () => {
  it("GET /api/v1/jobs/admin/all — 200 returns all jobs for admin", async () => {
    const admin = await createAdminUser();
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN });
    await createJobPosting(user.id, { status: JobStatus.CLOSED });

    const res = await request(app)
      .get("/api/v1/jobs/admin/all")
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobs).toHaveLength(2);
  });

  it("GET /api/v1/jobs/admin/all — 401 unauthenticated", async () => {
    const res = await request(app).get("/api/v1/jobs/admin/all");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/jobs/admin/all — 403 non-admin", async () => {
    const user = await createUser();
    const res = await request(app)
      .get("/api/v1/jobs/admin/all")
      .set(authHeaders(user));

    expect(res.status).toBe(403);
  });

  it("POST /api/v1/jobs/admin — 201 creates job for admin", async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post("/api/v1/jobs/admin")
      .set(await authWithCsrfHeaders(admin))
      .send({
        title: "Admin Created Job",
        description: "Great opportunity!",
        department: "Engineering",
        location: "Remote",
        locationType: "REMOTE",
        type: "FULL_TIME",
        experienceLevel: "MID",
        salaryMin: 90000,
        salaryMax: 130000,
        salaryCurrency: "USD",
        status: "OPEN",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Admin Created Job");
    expect(res.body.data.slug).toBe("admin-created-job");
  });

  it("POST /api/v1/jobs/admin — 400 validation error", async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post("/api/v1/jobs/admin")
      .set(await authWithCsrfHeaders(admin))
      .send({ title: "" }); // Invalid title

    expect(res.status).toBe(400);
  });

  it("PUT /api/v1/jobs/admin/:id — 200 updates job for admin", async () => {
    const admin = await createAdminUser();
    const job = await createJobPosting(admin.id, { title: "Original Title" });

    const res = await request(app)
      .put(`/api/v1/jobs/admin/${job.id}`)
      .set(await authWithCsrfHeaders(admin))
      .send({ title: "Updated Title" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Updated Title");
    expect(res.body.data.slug).toBe("updated-title");
  });

  it("DELETE /api/v1/jobs/admin/:id — 200 deletes job for admin", async () => {
    const admin = await createAdminUser();
    const job = await createJobPosting(admin.id);

    const res = await request(app)
      .delete(`/api/v1/jobs/admin/${job.id}`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await prisma.jobPosting.findUnique({ where: { id: job.id } });
    expect(db).toBeNull();
  });

  it("PATCH /api/v1/jobs/admin/:id/pin — 200 toggles pin for admin", async () => {
    const admin = await createAdminUser();
    const job = await createJobPosting(admin.id, { isPinned: false });

    const res = await request(app)
      .patch(`/api/v1/jobs/admin/${job.id}/pin`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.isPinned).toBe(true);

    const res2 = await request(app)
      .patch(`/api/v1/jobs/admin/${job.id}/pin`)
      .set(await authWithCsrfHeaders(admin));

    expect(res2.status).toBe(200);
    expect(res2.body.data.isPinned).toBe(false);
  });
});
