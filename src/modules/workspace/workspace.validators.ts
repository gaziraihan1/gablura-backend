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
  plan: z.enum(["FREE", "PRO", "BUSINESS", "ENTERPRISE"]).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(3).max(50).optional(),
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
