import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { validate, validateBody, validateQuery, validateParams } from "../../../middleware/validate.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createReq(overrides?: Partial<Request>): Request {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next = vi.fn() as NextFunction;

// ─── Test schemas ──────────────────────────────────────────────────────────

const simpleBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().int().min(0),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const paramsSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const transformSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  count: z.coerce.number().int().default(0),
});

// ─── validate() ────────────────────────────────────────────────────────────

describe("validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("body validation", () => {
    it("calls next() when body is valid", () => {
      const req = createReq({ body: { name: "Alice", age: 30 } });
      const res = createRes();

      validate(simpleBodySchema, "body")(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it("replaces body with parsed (transformed) data", () => {
      // Use a clean email — Zod v4 validates before transforms,
      // so leading/trailing spaces fail .email() before .toLowerCase() runs.
      const req = createReq({ body: { email: "USER@EXAMPLE.COM", count: "5" } });
      const res = createRes();

      validate(transformSchema, "body")(req, res, next);

      expect(next).toHaveBeenCalled();
      // .toLowerCase() transform applied
      expect((req as any).body.email).toBe("user@example.com");
      // .coerce.number transform applied
      expect((req as any).body.count).toBe(5);
    });

    it("throws ValidationError when body is invalid", () => {
      const req = createReq({ body: { age: 30 } }); // missing name
      const res = createRes();

      expect(() => {
        validate(simpleBodySchema, "body")(req, res, next);
      }).toThrow("Validation failed on body");
    });

    it("throws ValidationError with structured errors", () => {
      const req = createReq({ body: {} });
      const res = createRes();

      try {
        validate(simpleBodySchema, "body")(req, res, next);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.name).toBe("ValidationError");
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.errors).toBeDefined();
        expect(err.errors[0].fieldErrors).toBeDefined();
      }
    });

    it("reports all field errors, not just the first", () => {
      const req = createReq({ body: {} }); // missing both name and age
      const res = createRes();

      try {
        validate(simpleBodySchema, "body")(req, res, next);
        expect.fail("Should have thrown");
      } catch (err: any) {
        const fieldErrors = err.errors[0].fieldErrors;
        expect(fieldErrors.name).toBeDefined();
        expect(fieldErrors.age).toBeDefined();
      }
    });

    it("does not call next() on validation failure", () => {
      const req = createReq({ body: { name: "" } });
      const res = createRes();

      try {
        validate(simpleBodySchema, "body")(req, res, next);
      } catch {
        // expected
      }

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("query validation", () => {
    it("calls next() when query is valid", () => {
      const req = createReq({ query: { page: "1", limit: "20" } });
      const res = createRes();

      validate(querySchema, "query")(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("applies defaults when query params are missing", () => {
      const req = createReq({ query: {} });
      const res = createRes();

      validate(querySchema, "query")(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).query.page).toBe(1);
      expect((req as any).query.limit).toBe(20);
    });

    it("coerces string query params to numbers", () => {
      const req = createReq({ query: { page: "3", limit: "50" } });
      const res = createRes();

      validate(querySchema, "query")(req, res, next);

      expect((req as any).query.page).toBe(3);
      expect((req as any).query.limit).toBe(50);
    });

    it("rejects invalid query params", () => {
      const req = createReq({ query: { page: "0", limit: "200" } });
      const res = createRes();

      expect(() => {
        validate(querySchema, "query")(req, res, next);
      }).toThrow("Validation failed on query");
    });
  });

  describe("params validation", () => {
    it("calls next() when params are valid", () => {
      const req = createReq({ params: { id: "abc-123" } });
      const res = createRes();

      validate(paramsSchema, "params")(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("throws when params are missing", () => {
      const req = createReq({ params: {} });
      const res = createRes();

      expect(() => {
        validate(paramsSchema, "params")(req, res, next);
      }).toThrow("Validation failed on params");
    });
  });

  describe("default target", () => {
    it("defaults to body when target is not specified", () => {
      const req = createReq({ body: { name: "Alice", age: 30 } });
      const res = createRes();

      validate(simpleBodySchema)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── validateBody() ────────────────────────────────────────────────────────

describe("validateBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates req.body", () => {
    const req = createReq({ body: { name: "Bob", age: 25 } });
    const res = createRes();

    validateBody(simpleBodySchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid body", () => {
    const req = createReq({ body: {} });
    const res = createRes();

    expect(() => {
      validateBody(simpleBodySchema)(req, res, next);
    }).toThrow("Validation failed on body");
  });
});

// ─── validateQuery() ───────────────────────────────────────────────────────

describe("validateQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates req.query", () => {
    const req = createReq({ query: { page: "1" } });
    const res = createRes();

    validateQuery(querySchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("applies defaults to req.query", () => {
    const req = createReq({ query: {} });
    const res = createRes();

    validateQuery(querySchema)(req, res, next);

    expect((req as any).query.limit).toBe(20);
  });

  it("rejects invalid query", () => {
    const req = createReq({ query: { limit: "999" } });
    const res = createRes();

    expect(() => {
      validateQuery(querySchema)(req, res, next);
    }).toThrow("Validation failed on query");
  });
});

// ─── validateParams() ──────────────────────────────────────────────────────

describe("validateParams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates req.params", () => {
    const req = createReq({ params: { id: "test-id" } });
    const res = createRes();

    validateParams(paramsSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid params", () => {
    const req = createReq({ params: {} });
    const res = createRes();

    expect(() => {
      validateParams(paramsSchema)(req, res, next);
    }).toThrow("Validation failed on params");
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles deeply nested path errors", () => {
    const nestedSchema = z.object({
      user: z.object({
        profile: z.object({
          name: z.string().min(1),
        }),
      }),
    });

    const req = createReq({ body: { user: { profile: { name: "" } } } });
    const res = createRes();

    try {
      validate(nestedSchema, "body")(req, res, next);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.errors[0].fieldErrors["user.profile.name"]).toBeDefined();
    }
  });

  it("handles array items validation", () => {
    const arraySchema = z.object({
      tags: z.array(z.string().min(1)),
    });

    const req = createReq({ body: { tags: ["valid", ""] } });
    const res = createRes();

    expect(() => {
      validate(arraySchema, "body")(req, res, next);
    }).toThrow("Validation failed on body");
  });

  it("handles union schemas", () => {
    const unionSchema = z.union([z.string(), z.number()]);

    const req = createReq({ body: "hello" });
    const res = createRes();

    validate(unionSchema, "body")(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("preserves req properties not in the target", () => {
    const req = createReq({
      body: { name: "Alice", age: 30 },
      headers: { authorization: "Bearer token" },
    });
    const res = createRes();

    validate(simpleBodySchema, "body")(req, res, next);

    expect(req.headers).toEqual({ authorization: "Bearer token" });
  });
});
