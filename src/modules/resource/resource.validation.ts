import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";
import { ValidationError } from "../../errors/AppError.js";

export const resourceStatusSchema = z.enum(["DRAFT", "PUBLIC", "ARCHIVE"]);

// ─── Popular Resource ───────────────────────────────────────────────────────

export const createPopularResourceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(5000),
  image: z.string().trim().url("Image must be a valid URL"),
  category: z.string().trim().min(1, "Category is required").max(100),
  status: resourceStatusSchema.default("DRAFT"),
});

export const updatePopularResourceSchema = createPopularResourceSchema.partial();

export const popularResourceListQuerySchema = z.object({
  status: resourceStatusSchema.optional(),
  category: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(8),
});

// ─── Product Update ─────────────────────────────────────────────────────────

export const createProductUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  date: z.coerce.date({ error: () => ({ message: "A valid date is required" }) }),
  description: z.string().trim().min(1, "Description is required").max(5000),
  version: z.string().trim().min(1, "Version is required").max(50),
  status: resourceStatusSchema.default("DRAFT"),
});

export const updateProductUpdateSchema = createProductUpdateSchema.partial();

export const productUpdateListQuerySchema = z.object({
  status: resourceStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Shared ──────────────────────────────────────────────────────────────────

export const resourceSlugParamSchema = z.object({
  slug: z.string().trim().min(1, "Slug is required"),
});


type ValidationSource = "body" | "query" | "params";

/**
 * validate(schema, source) — parses req[source] against a Zod schema and
 * replaces it with the parsed (coerced/defaulted) value. Any ZodError is
 * converted into a ValidationError so it flows through your existing
 * errorHandler and comes back to the client as a 400 with a field-level
 * `errors` array — same shape errorHandler already special-cases.
 *
 * If you already have a Zod-interception middleware elsewhere in Focura,
 * reuse that one instead — this is a drop-in if you don't.
 */
declare module "express-serve-static-core" {
  interface Request {
    validatedQuery?: any;
    validatedParams?: any;
  }
}

export const validate = (schema: ZodSchema, source: ValidationSource = "body") =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);

      if (source === "query") {
        // Don't reassign/mutate req.query — Express 5's getter can hand back
        // the original string-typed object on next access. Store the
        // coerced result separately and have controllers read from there.
        req.validatedQuery = parsed;
      } else if (source === "params") {
        req.validatedParams = parsed;
      } else {
        (req as Record<ValidationSource, unknown>)[source] = parsed;
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          new ValidationError(
            "Validation failed",
            err.issues.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          ),
        );
      }
      next(err);
    }
  };