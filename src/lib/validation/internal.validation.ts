import { z } from "zod";

// ─── Shared ──────────────────────────────────────────────────────────────────

const emailSchema = z
  .string()
  .min(1, "Email is required")
  .max(254, "Email must be at most 254 characters")
  .email("Invalid email format")
  .toLowerCase()
  .trim();

// ─── POST /failed-attempt ────────────────────────────────────────────────────

export const failedAttemptSchema = z.object({
  email: emailSchema,
});

export type FailedAttemptBody = z.infer<typeof failedAttemptSchema>;

// ─── POST /clear-attempts ────────────────────────────────────────────────────

export const clearAttemptsSchema = z.object({
  email: emailSchema,
});

export type ClearAttemptsBody = z.infer<typeof clearAttemptsSchema>;

// ─── POST /audit ─────────────────────────────────────────────────────────────

const INTERNAL_AUDIT_EVENTS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGIN_BLOCKED",
  "ACCOUNT_LOCKED",
] as const;

export const auditEventSchema = z.object({
  event: z.enum(INTERNAL_AUDIT_EVENTS, "Unsupported audit event"),
  userId: z.string().optional(),
  email: z.string().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  reason: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEventBody = z.infer<typeof auditEventSchema>;

// ─── POST /revoke-sessions ───────────────────────────────────────────────────

export const revokeSessionsSchema = z.object({
  email: emailSchema,
});

export type RevokeSessionsBody = z.infer<typeof revokeSessionsSchema>;

// ─── POST /2fa-verify ────────────────────────────────────────────────────────

export const internal2FAVerifySchema = z.object({
  userId: z
    .string()
    .min(1, "User ID is required")
    .trim(),
  totpCode: z
    .string()
    .min(1, "TOTP code is required")
    .regex(/^\d{6}$/, "TOTP code must be exactly 6 digits")
    .trim(),
});

export type Internal2FAVerifyBody = z.infer<typeof internal2FAVerifySchema>;

// ─── POST /2fa-check ─────────────────────────────────────────────────────────

export const internal2FACheckSchema = z.object({
  userId: z
    .string()
    .min(1, "User ID is required")
    .trim(),
});

export type Internal2FACheckBody = z.infer<typeof internal2FACheckSchema>;
