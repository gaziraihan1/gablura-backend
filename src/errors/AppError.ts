/**
 * AppError — base class for all application errors.
 *
 * Throw these anywhere (routes, services, middleware) and the global
 * errorHandler will serialize them consistently.
 *
 * Usage:
 *   throw new NotFoundError("User");
 *   throw new ForbiddenError("Insufficient permissions", "FORBIDDEN");
 */
export class AppError extends Error {
  /** HTTP status code sent to the client */
  public readonly statusCode: number;
  /** Machine-readable error code for the client to branch on */
  public readonly code: string;
  /** Whether this error is expected / operational (vs. a programming bug) */
  public readonly isOperational: boolean;
  /** Extra fields merged into the JSON response */
  public readonly meta?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    meta?: Record<string, unknown>,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.meta = meta;

    // Restore prototype chain (needed when targeting ES5)
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── 400 ──────────────────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  public readonly errors?: unknown[];

  constructor(
    message = "Validation failed",
    errors?: unknown[],
    code = "VALIDATION_ERROR",
  ) {
    super(message, 400, code);
    this.errors = errors;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST") {
    super(message, 400, code);
  }
}

// ─── 401 ──────────────────────────────────────────────────────────────────────

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

// ─── 403 ──────────────────────────────────────────────────────────────────────

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor() {
    super("Please verify your email address", 403, "EMAIL_NOT_VERIFIED");
  }
}

export class AccountBannedError extends AppError {
  constructor(reason?: string | null, bannedAt?: Date | null) {
    super("Your account has been suspended", 403, "ACCOUNT_BANNED", {
      reason: reason ?? undefined,
      bannedAt: bannedAt ?? undefined,
    });
  }
}

export class PlanLimitError extends AppError {
  constructor(message = "Plan limit exceeded") {
    super(message, 403, "PLAN_LIMIT_EXCEEDED");
  }
}

// ─── 404 ──────────────────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource = "Resource", code = "NOT_FOUND", meta?: Record<string, unknown>) {
    super(`${resource} not found`, 404, code, meta);
  }
}

// ─── 409 ──────────────────────────────────────────────────────────────────────

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT", meta?: Record<string, unknown>) {
    super(message, 409, code, meta);
  }
}

// ─── 429 ──────────────────────────────────────────────────────────────────────

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super(
      "Rate limit exceeded. Please try again later.",
      429,
      "RATE_LIMIT_EXCEEDED",
      retryAfter ? { retryAfterMs: retryAfter } : undefined,
    );
    this.retryAfter = retryAfter;
  }
}

// ─── Auth-specific token errors ───────────────────────────────────────────────

export class TokenExpiredError extends UnauthorizedError {
  constructor() {
    super("Token expired. Please refresh your session.", "TOKEN_EXPIRED");
  }
}

export class TokenRevokedError extends UnauthorizedError {
  constructor() {
    super("Token has been revoked", "TOKEN_REVOKED");
  }
}

export class InvalidTokenError extends UnauthorizedError {
  constructor(code = "INVALID_TOKEN") {
    super("Invalid token", code);
  }
}

export class SessionHijackError extends UnauthorizedError {
  public readonly reason?: string;

  constructor(reason?: string) {
    super("Session validation failed. Please login again.", "SESSION_HIJACK_DETECTED");
    this.reason = reason;
  }
}

// ─── 502 / 503 AI service errors ─────────────────────────────────────────────

/**
 * Thrown when the AI provider cannot be reached, is unconfigured, or times
 * out. Maps to 503 so the client can surface a friendly "try again later"
 * notice instead of a generic 500.
 */
export class AiServiceUnavailableError extends AppError {
  constructor(message = "AI service is currently unavailable. Please try again later.") {
    super(message, 503, "AI_SERVICE_UNAVAILABLE");
  }
}

/**
 * Thrown when the LLM returns malformed JSON or output that fails the
 * feature's Zod schema. Maps to 502 — the upstream responded but the
 * contract was violated.
 */
export class AiInvalidResponseError extends AppError {
  constructor(message = "The AI service returned an unexpected response. Please try again.") {
    super(message, 502, "AI_INVALID_RESPONSE");
  }
}

/**
 * Thrown before an LLM call when the scope's monthly token budget would be
 * exceeded by the worst-case cost of the request. Maps to 429 with the
 * seconds until the budget resets (start of next month) in `retryAfter`.
 */
export class AiMonthlyQuotaExceededError extends AppError {
  public readonly retryAfter?: number;

  constructor(retryAfterSeconds: number) {
    super(
      "You've reached the monthly AI token limit for this plan. Upgrade to unlock more, or try again next month.",
      429,
      "AI_MONTHLY_QUOTA_EXCEEDED",
    );
    this.retryAfter = retryAfterSeconds;
  }
}

/**
 * Thrown when the AI provider itself is rate-limiting or quota-exhausted for
 * the request (Google 429 / RESOURCE_EXHAUSTED / RATE_LIMIT_EXCEEDED). Maps to
 * 429 so clients can surface "the AI provider is busy right now — try again in
 * a moment" instead of the misleading 503 used for genuine provider outages.
 * The provider's message is kept in `meta.providerDetail` for debugging.
 */
export class AiProviderRateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(retryAfterSeconds = 60, providerDetail?: string) {
    super(
      "The AI provider is receiving too many requests right now. Please try again in a moment.",
      429,
      "AI_PROVIDER_RATE_LIMIT",
      providerDetail ? { providerDetail } : undefined,
    );
    this.retryAfter = retryAfterSeconds;
  }
}

// ─── 429 Storage / upload quota errors ───────────────────────────────────────

/**
 * Thrown when an upload is blocked by storage or rate-limit quota.
 * Carries the specific quota code and an optional retryAfterMs for
 * rate-limit windows so the client knows exactly when to retry.
 */
export class QuotaError extends AppError {
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    code:
      | "STORAGE_FULL"
      | "FILE_TOO_LARGE"
      | "DAILY_LIMIT"
      | "RATE_LIMIT_MINUTE"
      | "RATE_LIMIT_HOUR",
    retryAfterMs?: number,
  ) {
    super(message, 429, code, retryAfterMs ? { retryAfterMs } : undefined);
    this.retryAfterMs = retryAfterMs;
  }
}