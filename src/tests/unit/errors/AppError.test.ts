import { describe, it, expect } from "vitest";

import {
  AppError,
  ValidationError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  EmailNotVerifiedError,
  AccountBannedError,
  PlanLimitError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  TokenExpiredError,
  TokenRevokedError,
  InvalidTokenError,
  SessionHijackError,
  QuotaError,
} from "../../../errors/AppError.js";

describe("AppError", () => {
  it("creates base error with correct properties", () => {
    const error = new AppError("Test error", 400, "TEST_CODE");
    expect(error.message).toBe("Test error");
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("TEST_CODE");
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe("AppError");
  });

  it("accepts meta object", () => {
    const meta = { field: "value" };
    const error = new AppError("Test", 400, "TEST", meta);
    expect(error.meta).toEqual(meta);
  });

  it("can be marked as non-operational", () => {
    const error = new AppError("Test", 500, "INTERNAL", undefined, false);
    expect(error.isOperational).toBe(false);
  });

  it("maintains prototype chain", () => {
    const error = new AppError("Test", 400, "TEST");
    expect(error instanceof AppError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

describe("ValidationError", () => {
  it("creates validation error with default values", () => {
    const error = new ValidationError();
    expect(error.message).toBe("Validation failed");
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts custom message and errors", () => {
    const errors = [{ field: "email", message: "Invalid email" }];
    const error = new ValidationError("Custom message", errors, "CUSTOM_CODE");
    expect(error.message).toBe("Custom message");
    expect(error.errors).toEqual(errors);
    expect(error.code).toBe("CUSTOM_CODE");
  });
});

describe("BadRequestError", () => {
  it("creates bad request error with default values", () => {
    const error = new BadRequestError();
    expect(error.message).toBe("Bad request");
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("accepts custom message and code", () => {
    const error = new BadRequestError("Custom message", "CUSTOM");
    expect(error.message).toBe("Custom message");
    expect(error.code).toBe("CUSTOM");
  });
});

describe("UnauthorizedError", () => {
  it("creates unauthorized error with default values", () => {
    const error = new UnauthorizedError();
    expect(error.message).toBe("Unauthorized");
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
  });
});

describe("ForbiddenError", () => {
  it("creates forbidden error with default values", () => {
    const error = new ForbiddenError();
    expect(error.message).toBe("Forbidden");
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
  });
});

describe("EmailNotVerifiedError", () => {
  it("creates email not verified error", () => {
    const error = new EmailNotVerifiedError();
    expect(error.message).toBe("Please verify your email address");
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("EMAIL_NOT_VERIFIED");
  });
});

describe("AccountBannedError", () => {
  it("creates account banned error with reason and date", () => {
    const reason = "ToS violation";
    const bannedAt = new Date("2024-01-01");
    const error = new AccountBannedError(reason, bannedAt);
    expect(error.message).toBe("Your account has been suspended");
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("ACCOUNT_BANNED");
    expect(error.meta?.reason).toBe(reason);
    expect(error.meta?.bannedAt).toEqual(bannedAt);
  });

  it("handles null reason and bannedAt", () => {
    const error = new AccountBannedError(null, null);
    expect(error.meta?.reason).toBeUndefined();
    expect(error.meta?.bannedAt).toBeUndefined();
  });
});

describe("PlanLimitError", () => {
  it("creates plan limit error with default message", () => {
    const error = new PlanLimitError();
    expect(error.message).toBe("Plan limit exceeded");
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("accepts custom message", () => {
    const error = new PlanLimitError("Custom limit message");
    expect(error.message).toBe("Custom limit message");
  });
});

describe("NotFoundError", () => {
  it("creates not found error with default resource", () => {
    const error = new NotFoundError();
    expect(error.message).toBe("Resource not found");
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("accepts custom resource name", () => {
    const error = new NotFoundError("User");
    expect(error.message).toBe("User not found");
  });

  it("accepts custom code and meta", () => {
    const meta = { id: "123" };
    const error = new NotFoundError("User", "USER_NOT_FOUND", meta);
    expect(error.code).toBe("USER_NOT_FOUND");
    expect(error.meta).toEqual(meta);
  });
});

describe("ConflictError", () => {
  it("creates conflict error with default values", () => {
    const error = new ConflictError();
    expect(error.message).toBe("Conflict");
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("CONFLICT");
  });

  it("accepts custom message, code, and meta", () => {
    const meta = { field: "email" };
    const error = new ConflictError("Email exists", "EMAIL_EXISTS", meta);
    expect(error.message).toBe("Email exists");
    expect(error.code).toBe("EMAIL_EXISTS");
    expect(error.meta).toEqual(meta);
  });
});

describe("RateLimitError", () => {
  it("creates rate limit error without retry after", () => {
    const error = new RateLimitError();
    expect(error.message).toBe("Rate limit exceeded. Please try again later.");
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.retryAfter).toBeUndefined();
  });

  it("accepts retry after value", () => {
    const error = new RateLimitError(60);
    expect(error.retryAfter).toBe(60);
    expect(error.meta?.retryAfterMs).toBe(60);
  });
});

describe("TokenExpiredError", () => {
  it("creates token expired error", () => {
    const error = new TokenExpiredError();
    expect(error.message).toBe("Token expired. Please refresh your session.");
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("TOKEN_EXPIRED");
  });
});

describe("TokenRevokedError", () => {
  it("creates token revoked error", () => {
    const error = new TokenRevokedError();
    expect(error.message).toBe("Token has been revoked");
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("TOKEN_REVOKED");
  });
});

describe("InvalidTokenError", () => {
  it("creates invalid token error with default code", () => {
    const error = new InvalidTokenError();
    expect(error.message).toBe("Invalid token");
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("INVALID_TOKEN");
  });

  it("accepts custom code", () => {
    const error = new InvalidTokenError("MALFORMED_TOKEN");
    expect(error.code).toBe("MALFORMED_TOKEN");
  });
});

describe("SessionHijackError", () => {
  it("creates session hijack error without reason", () => {
    const error = new SessionHijackError();
    expect(error.message).toBe("Session validation failed. Please login again.");
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("SESSION_HIJACK_DETECTED");
    expect(error.reason).toBeUndefined();
  });

  it("accepts reason", () => {
    const error = new SessionHijackError("IP address changed");
    expect(error.reason).toBe("IP address changed");
  });
});

describe("QuotaError", () => {
  it("creates quota error with storage full code", () => {
    const error = new QuotaError("Storage full", "STORAGE_FULL");
    expect(error.message).toBe("Storage full");
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe("STORAGE_FULL");
  });

  it("creates quota error with file too large code", () => {
    const error = new QuotaError("File too large", "FILE_TOO_LARGE");
    expect(error.code).toBe("FILE_TOO_LARGE");
  });

  it("creates quota error with daily limit code", () => {
    const error = new QuotaError("Daily limit reached", "DAILY_LIMIT");
    expect(error.code).toBe("DAILY_LIMIT");
  });

  it("creates quota error with rate limit codes", () => {
    const minuteError = new QuotaError("Minute limit", "RATE_LIMIT_MINUTE");
    expect(minuteError.code).toBe("RATE_LIMIT_MINUTE");

    const hourError = new QuotaError("Hour limit", "RATE_LIMIT_HOUR");
    expect(hourError.code).toBe("RATE_LIMIT_HOUR");
  });

  it("accepts retry after value", () => {
    const error = new QuotaError("Rate limited", "RATE_LIMIT_MINUTE", 30000);
    expect(error.retryAfterMs).toBe(30000);
    expect(error.meta?.retryAfterMs).toBe(30000);
  });
});