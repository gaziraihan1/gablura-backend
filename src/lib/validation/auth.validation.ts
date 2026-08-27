import { z } from "zod";

// ─── Shared ──────────────────────────────────────────────────────────────────

const CUID_REGEX = /^c[a-z0-9]{24,}$/;

const cuidString = z
  .string()
  .min(1, "Required")
  .regex(CUID_REGEX, "Invalid ID format");

const emailSchema = z
  .string()
  .min(1, "Email is required")
  .max(254, "Email must be at most 254 characters")
  .email("Invalid email format")
  .toLowerCase()
  .trim();

// ─── POST /exchange ──────────────────────────────────────────────────────────

export const exchangeSchema = z.object({
  userId: cuidString,
  email: emailSchema,
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"], "Role must be USER, ADMIN, or SUPER_ADMIN"),
  sessionId: z.string().uuid("Session ID must be a valid UUID"),
  timestamp: z
    .number()
    .int("Timestamp must be an integer")
    .refine((val) => {
      const age = Date.now() - val;
      return age >= 0 && age <= 60_000;
    }, "Proof must be between 0 and 60 seconds old"),
  signature: z
    .string()
    .min(1, "Signature is required")
    .regex(/^[a-f0-9]{64}$/, "Signature must be a 64-character hex string"),
});

export type ExchangeBody = z.infer<typeof exchangeSchema>;

// ─── POST /refresh ───────────────────────────────────────────────────────────

export const refreshSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "Refresh token is required")
    .regex(/^eyJ/, "Refresh token must be a valid JWT"),
});

export type RefreshBody = z.infer<typeof refreshSchema>;

// ─── POST /logout ────────────────────────────────────────────────────────────

export const logoutSchema = z.object({
  logoutAll: z.boolean().optional().default(false),
});

export type LogoutBody = z.infer<typeof logoutSchema>;
