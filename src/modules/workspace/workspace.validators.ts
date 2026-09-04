import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i)
    .optional(),
  logo: z.string().url().optional(),
  isPublic: z.boolean().optional(),
  // NOTE: `plan` is deliberately NOT part of the create schema. Workspaces
  // always start on FREE; a paid tier can only be granted by the billing
  // flow (upgrade/checkout/webhook) or a Gablura admin (limits endpoint).
  // Any client-sent `plan` is stripped by Zod (non-strict) and ignored.
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // NOTE: `slug` is deliberately NOT part of the update schema. Workspace
  // slugs are generated server-side at creation and immutable afterwards —
  // Announcement and Project rows reference the workspace by slug, and the
  // slug-keyed caches assume it never changes. Any client-sent `slug` is
  // stripped by Zod (non-strict) and ignored.
  description: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i)
    .optional(),
  logo: z.string().url().optional(),
  isPublic: z.boolean().optional(),
  allowInvites: z.boolean().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["MEMBER", "ADMIN", "GUEST"]),
});

export type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberBody = z.infer<typeof inviteMemberSchema>;
