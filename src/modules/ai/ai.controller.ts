import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import { AiAccess } from "./ai.access.js";
import { AiService } from "./ai.service.js";
import {
  autocompleteInputSchema,
  breakdownInputSchema,
  commentAssistInputSchema,
  dailyPlanInputSchema,
  meetingSummaryInputSchema,
  quotaQuerySchema,
  usageQuerySchema,
  weeklyInsightsInputSchema,
} from "./ai.validators.js";

/** Shared scope resolution: validates optional workspaceId + membership. */
function getWorkspaceId(req: AuthRequest): string | undefined {
  return (req.body?.workspaceId ?? req.query?.workspaceId) as string | undefined;
}

export const autocomplete = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = autocompleteInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = getWorkspaceId(req);
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.autocomplete(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const breakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = breakdownInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = getWorkspaceId(req);
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.breakdown(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const commentAssist = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = commentAssistInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = getWorkspaceId(req);
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.commentAssist(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const planDaily = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = dailyPlanInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = getWorkspaceId(req);
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.planDaily(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const summarizeMeeting = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = meetingSummaryInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = getWorkspaceId(req);
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.summarizeMeeting(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const weeklyInsights = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = weeklyInsightsInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  // Insights require the workspaceId (validator enforces it) — always verify
  // the caller is a member before aggregating workspace data.
  await AiAccess.assertWorkspaceMember(req.user!.id, parsed.data.workspaceId);

  const data = await AiService.weeklyInsights(parsed.data, req.user!.id);
  res.json({ success: true, data });
});

export const getQuota = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = quotaQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  const workspaceId = parsed.data.workspaceId;
  if (workspaceId) await AiAccess.assertWorkspaceMember(req.user!.id, workspaceId);

  const data = await AiService.getQuota({ userId: req.user!.id, workspaceId });
  res.json({ success: true, data });
});

export const getUsage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = usageQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError("Validation error", parsed.error.issues);

  // AI spend is billing-sensitive — owners and admins only.
  await AiAccess.assertWorkspaceAdminOrOwner(req.user!.id, parsed.data.workspaceId);

  const data = await AiService.getUsageReport(
    parsed.data.workspaceId,
    parsed.data.days ?? 30,
  );
  res.json({ success: true, data });
});
