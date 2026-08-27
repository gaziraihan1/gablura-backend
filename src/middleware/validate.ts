import { Request, Response, NextFunction } from "express";
import { z, ZodSchema, ZodError } from "zod";
import { ValidationError } from "../errors/AppError.js";

type ValidationTarget = "body" | "query" | "params";

/**
 * Express middleware that validates `req[target]` against a Zod schema.
 *
 * Usage:
 *   router.post("/exchange", validate(exchangeSchema, "body"), handler);
 *   router.get("/members", validate(membersQuerySchema, "query"), handler);
 *   router.delete("/sessions/:sessionId", validate(revokeSessionSchema, "params"), handler);
 *
 * On failure, throws a ValidationError with structured error details so the
 * global error handler returns a consistent 400 response.
 */
export function validate(schema: ZodSchema, target: ValidationTarget = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[target];

    const result = schema.safeParse(data);

    if (result.success) {
      // Replace raw input with parsed/transformed data (coerced types, defaults applied)
      (req as any)[target] = result.data;
      return next();
    }

    // Format Zod errors into a readable structure
    const formattedErrors = formatZodErrors(result.error);

    throw new ValidationError(
      `Validation failed on ${target}`,
      [{ fieldErrors: formattedErrors }],
      "VALIDATION_ERROR",
    );
  };
}

/**
 * Wraps an async route handler with a try-catch that forwards errors to next().
 * Used alongside `validate()` so thrown ValidationErrors reach the global handler.
 */
export function validateBody(schema: ZodSchema) {
  return validate(schema, "body");
}

export function validateQuery(schema: ZodSchema) {
  return validate(schema, "query");
}

export function validateParams(schema: ZodSchema) {
  return validate(schema, "params");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const key = path || "_root";

    if (!formatted[key]) {
      formatted[key] = [];
    }
    formatted[key].push(issue.message);
  }

  return formatted;
}
