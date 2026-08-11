import { z } from "zod";
import { WorkspacePlan } from "@prisma/client";

export const paginationSchema = z.object({
  page:        z.coerce.number().int().min(1).default(1),
  pageSize:    z.coerce.number().int().min(1).max(100).default(20),
  search:      z.string().optional(),
  workspaceId: z.string().optional(),
});

const aiOverrideField = z
  .union([
    z.null(),
    z.coerce
      .number()
      .int()
      .min(1, "must be a positive integer, or null for the plan default"),
  ])
  .optional();

export const updateWorkspaceLimitsSchema = z.object({
  plan: z.nativeEnum(WorkspacePlan),
  maxMembers: z.coerce
    .number()
    .int()
    .refine((v) => v === -1 || v > 0, {
      message: "maxMembers must be a positive integer, or -1 for unlimited",
    }),
  maxStorage: z.coerce
    .number()
    .int()
    .refine((v) => v === -1 || v > 0, {
      message: "maxStorage (MB) must be a positive integer, or -1 for unlimited",
    }),
  // Focura-admin AI overrides — null (or omitted) = fall back to the plan
  // default for the workspace's plan.
  aiDailyCalls: aiOverrideField,
  aiMonthlyTokens: aiOverrideField,
  aiMaxOutputTokens: aiOverrideField,
});

export const banUserSchema = z.object({
  reason: z.string().min(1, "Reason is required").max(500),
});

export const deleteWorkspaceSchema = z.object({
  reason:     z.string().max(500).optional(),
  hardDelete: z.boolean().default(false),
});

export type PaginationInput           = z.infer<typeof paginationSchema>;
export type UpdateWorkspaceLimitsInput = z.infer<typeof updateWorkspaceLimitsSchema>;
export type BanUserInput              = z.infer<typeof banUserSchema>;
export type DeleteWorkspaceInput      = z.infer<typeof deleteWorkspaceSchema>;