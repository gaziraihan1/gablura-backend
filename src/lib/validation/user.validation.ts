import { z } from "zod";

// ─── Shared ──────────────────────────────────────────────────────────────────

const CUID_REGEX = /^c[a-z0-9]{24,}$/;

const cuidString = z
  .string()
  .min(1, "Required")
  .regex(CUID_REGEX, "Invalid ID format");

// ─── PUT /profile ────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters")
    .trim()
    .optional(),
  bio: z
    .string()
    .max(500, "Bio must be at most 500 characters")
    .trim()
    .nullable()
    .optional(),
  timezone: z
    .string()
    .max(50, "Timezone must be at most 50 characters")
    .trim()
    .optional(),
  image: z
    .string()
    .url("Image must be a valid URL")
    .max(2000, "Image URL must be at most 2000 characters")
    .trim()
    .nullable()
    .optional(),
  notifications: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

// ─── PUT /password ───────────────────────────────────────────────────────────

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(128, "New password must be at most 128 characters"),
    confirmPassword: z
      .string()
      .min(1, "Please confirm your new password"),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

// ─── POST /2fa/setup ─────────────────────────────────────────────────────────

// No body required — 2FA setup uses the authenticated user's session

// ─── POST /2fa/verify ────────────────────────────────────────────────────────

export const verify2FASchema = z.object({
  token: z
    .string()
    .min(1, "Verification code is required")
    .regex(/^\d{6}$/, "Verification code must be exactly 6 digits")
    .trim(),
});

export type Verify2FABody = z.infer<typeof verify2FASchema>;

// ─── POST /2fa/disable ───────────────────────────────────────────────────────

export const disable2FASchema = z.object({
  password: z
    .string()
    .min(1, "Password is required to disable 2FA"),
});

export type Disable2FABody = z.infer<typeof disable2FASchema>;

// ─── DELETE /sessions/:sessionId ─────────────────────────────────────────────

export const revokeSessionSchema = z.object({
  sessionId: z
    .string()
    .min(1, "Session ID is required")
    .trim(),
});

export type RevokeSessionParams = z.infer<typeof revokeSessionSchema>;

// ─── GET /workspace-members ──────────────────────────────────────────────────

export const workspaceMembersQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(200, "Limit must be at most 200")
    .optional()
    .default(100),
});

export type WorkspaceMembersQuery = z.infer<typeof workspaceMembersQuerySchema>;
