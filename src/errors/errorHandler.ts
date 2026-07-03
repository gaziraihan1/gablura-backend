import { Request, Response, NextFunction } from "express";
import { AppError, ValidationError, RateLimitError, SessionHijackError, NotFoundError } from "./AppError.js";
import { captureException } from "../lib/sentry.js";

/**
 * Global error handler — mount LAST in your Express app:
 *
 *   app.use(errorHandler);
 *
 * Handles, in order:
 *   1. AppError subclasses (operational errors we threw intentionally)
 *   2. Prisma known error codes (P2002, P2003, P2025)
 *   3. Unhandled / programmer errors → 500
 */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // _next: NextFunction,
): void => {
  // ─── 1. Operational errors (AppError and subclasses) ──────────────────────
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      success: false,
      message: err.message,
      code: err.code,
    };

    // ValidationError carries field-level errors
    if (err instanceof ValidationError && err.errors) {
      body.errors = err.errors;
    }

    // RateLimitError carries retryAfter
    if (err instanceof RateLimitError && err.retryAfter != null) {
      body.retryAfter = err.retryAfter;
      res.setHeader("Retry-After", err.retryAfter);
    }

    // SessionHijackError carries the mismatch reason
    if (err instanceof SessionHijackError && err.reason) {
      body.reason = err.reason;
    }

    // Spread any extra meta fields (e.g. bannedAt, field names)
    if (err.meta) {
      Object.assign(body, err.meta);
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // ─── 2. Prisma errors ─────────────────────────────────────────────────────
  const prismaErr = err as any;

  if (prismaErr?.code === "P2002") {
    res.status(409).json({
      success: false,
      message: "A record with this value already exists",
      code: "DUPLICATE_ENTRY",
      field: prismaErr.meta?.target,
    });
    return;
  }

  if (prismaErr?.code === "P2003") {
    res.status(400).json({
      success: false,
      message: "Invalid reference to related record",
      code: "INVALID_REFERENCE",
    });
    return;
  }

  if (prismaErr?.code === "P2025") {
    res.status(404).json({
      success: false,
      message: "Record not found",
      code: "NOT_FOUND",
    });
    return;
  }

  // ─── 3. Unhandled / programmer errors ─────────────────────────────────────
  const isDev = process.env.NODE_ENV === "development";

  // Log non-operational errors loudly — these are bugs
  console.error("🔴 Unhandled error:", err);

  // Capture unhandled errors in Sentry
  if (err instanceof Error) {
    captureException(err, {
      request: {
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
        },
      },
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
    code: "INTERNAL_ERROR",
    ...(isDev && { stack: (err as Error)?.stack }),
  });
};

/**
 * 404 handler — mount BEFORE errorHandler but AFTER all routes:
 *
 *   app.use(notFoundHandler);
 *   app.use(errorHandler);
 */
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`, 'NOT_FOUND', {
    path: req.path,
    method: req.method,
  }));
};