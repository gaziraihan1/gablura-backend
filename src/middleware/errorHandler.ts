import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error("Error:", err);

  // ─── Prisma errors ───────────────────────────────────────────
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists",
      field: err.meta?.target,
    });
  }

  if (err.code === "P2003") {
    return res.status(400).json({
      success: false,
      message: "Invalid reference to related record",
    });
  }

  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      message: "Record not found",
    });
  }

  // ─── Billing / plan limits ───────────────────────────────────
  if (err.code === "PLAN_LIMIT_EXCEEDED") {
    return res.status(403).json({
      success: false,
      error: "PLAN_LIMIT_EXCEEDED",
      message: err.message || "Plan limit exceeded",
    });
  }

  // ─── Named error types ────────────────────────────────────────
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: err.errors,
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      success: false,
      message: err.message || "Unauthorized",
    });
  }

  if (err.name === "ForbiddenError") {
    return res.status(403).json({
      success: false,
      message: err.message || "Forbidden",
    });
  }

  if (err.name === "NotFoundError") {
    return res.status(404).json({
      success: false,
      message: err.message || "Not found",
    });
  }

  if (err.name === "ConflictError") {
    return res.status(409).json({
      success: false,
      message: err.message || "Conflict",
    });
  }

  // ─── Fallback ─────────────────────────────────────────────────
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
