import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { createUser, createAdminUser } from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";

const ADMIN_BASE = "/api/v1/admin/resources";
const PUBLIC_BASE = "/api/v1/resources";

describe("Resource API", () => {
  describe("Public Popular Resources", () => {
    it("GET /public/popular — should fetch public resources", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/popular`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it("GET /public/popular/:slug — should fetch a single public resource", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/popular/res`);

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe("res");
    });

    it("GET /public/popular/:slug — should return 404 for non-public resource", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "DRAFT",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/popular/res`);

      expect(res.status).toBe(404);
    });
  });

  describe("Public Product Updates", () => {
    it("GET /public/product-updates — should fetch public product updates", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/product-updates`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it("GET /public/product-updates/:slug — should fetch a single public product update", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/product-updates/update`);

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe("update");
    });

    it("GET /public/product-updates/:slug — should return 404 for non-public update", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "DRAFT",
          createdById: user.id,
        },
      });

      const res = await request(app).get(`${PUBLIC_BASE}/product-updates/update`);

      expect(res.status).toBe(404);
    });
  });

  describe("Admin Popular Resources", () => {
    let adminHeaders: any;

    beforeEach(async () => {
      const admin = await createAdminUser();
      adminHeaders = await authWithCsrfHeaders(admin);
    });

    it("GET /admin/popular — should list all resources", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .get(`${ADMIN_BASE}/popular`)
        .set(adminHeaders);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it("GET /admin/popular/:slug — should fetch a resource by slug", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .get(`${ADMIN_BASE}/popular/res`)
        .set(adminHeaders);

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe("res");
    });

    it("POST /admin/popular — should create a resource", async () => {
      const res = await request(app)
        .post(`${ADMIN_BASE}/popular`)
        .set(adminHeaders)
        .send({
          title: "New Resource",
          description: "A new resource",
          image: "http://example.com/image.jpg",
          category: "GENERAL",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("New Resource");
    });

    it("PATCH /admin/popular/:slug — should update a resource", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .patch(`${ADMIN_BASE}/popular/res`)
        .set(adminHeaders)
        .send({ title: "Updated Title" });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Updated Title");
    });

    it("DELETE /admin/popular/:slug — should delete a resource", async () => {
      const user = await createUser();
      await prisma.popularResource.create({
        data: {
          title: "Res",
          slug: "res",
          status: "PUBLIC",
          description: "Desc",
          image: "http://image.com",
          category: "GENERAL",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .delete(`${ADMIN_BASE}/popular/res`)
        .set(adminHeaders);

      expect(res.status).toBe(204);
    });

    it("GET /admin/popular/:slug — should return 404 for non-existent resource", async () => {
      const res = await request(app)
        .get(`${ADMIN_BASE}/popular/nonexistent`)
        .set(adminHeaders);

      expect(res.status).toBe(404);
    });
  });

  describe("Admin Product Updates", () => {
    let adminHeaders: any;

    beforeEach(async () => {
      const admin = await createAdminUser();
      adminHeaders = await authWithCsrfHeaders(admin);
    });

    it("GET /admin/product-updates — should list all product updates", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .get(`${ADMIN_BASE}/product-updates`)
        .set(adminHeaders);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it("GET /admin/product-updates/:slug — should fetch a product update by slug", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .get(`${ADMIN_BASE}/product-updates/update`)
        .set(adminHeaders);

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe("update");
    });

    it("POST /admin/product-updates — should create a product update", async () => {
      const res = await request(app)
        .post(`${ADMIN_BASE}/product-updates`)
        .set(adminHeaders)
        .send({
          title: "New Update",
          description: "A new update",
          version: "2.0",
          date: new Date().toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("New Update");
    });

    it("PATCH /admin/product-updates/:slug — should update a product update", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .patch(`${ADMIN_BASE}/product-updates/update`)
        .set(adminHeaders)
        .send({ title: "Updated Title" });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Updated Title");
    });

    it("DELETE /admin/product-updates/:slug — should delete a product update", async () => {
      const user = await createUser();
      await prisma.productUpdate.create({
        data: {
          title: "Update",
          slug: "update",
          description: "Desc",
          version: "1.0",
          date: new Date(),
          status: "PUBLIC",
          createdById: user.id,
        },
      });

      const res = await request(app)
        .delete(`${ADMIN_BASE}/product-updates/update`)
        .set(adminHeaders);

      expect(res.status).toBe(204);
    });

    it("GET /admin/product-updates/:slug — should return 404 for non-existent update", async () => {
      const res = await request(app)
        .get(`${ADMIN_BASE}/product-updates/nonexistent`)
        .set(adminHeaders);

      expect(res.status).toBe(404);
    });
  });

  describe("Validation Errors", () => {
    let adminHeaders: any;

    beforeEach(async () => {
      const admin = await createAdminUser();
      adminHeaders = await authWithCsrfHeaders(admin);
    });

    it("POST /admin/popular — should reject invalid data", async () => {
      const res = await request(app)
        .post(`${ADMIN_BASE}/popular`)
        .set(adminHeaders)
        .send({
          title: "",
          description: "A new resource",
          image: "invalid-url",
          category: "GENERAL",
        });

      expect(res.status).toBe(400);
    });

    it("POST /admin/product-updates — should reject invalid data", async () => {
      const res = await request(app)
        .post(`${ADMIN_BASE}/product-updates`)
        .set(adminHeaders)
        .send({
          title: "",
          description: "A new update",
          version: "1.0",
          date: "invalid-date",
        });

      expect(res.status).toBe(400);
    });
  });
});
