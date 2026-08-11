import { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { FeatureService } from "./feature.service.js";
import { isFocuraAdminUser } from "../../config/admin.config.js";
import { asyncHandler } from "../../errors/index.js";
import { ValidationError } from "../../errors/index.js";
import {
  createFeatureRequestSchema,
  updateFeatureStatusSchema,
  castVoteSchema,
  listFeaturesSchema,
} from "./feature.validation.js";

export const createFeatureRequest = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createFeatureRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const feature = await FeatureService.create({
      ...parsed.data,
      createdById: req.user!.id,
    });
    res.status(201).json({ success: true, data: feature });
  },
);

export const getFeatureRequests = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = listFeaturesSchema.safeParse(req.query);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const result = await FeatureService.getMany(parsed.data, req.user!.id);
    res.json({ success: true, ...result });
  },
);

export const getFeatureRequest = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const feature = await FeatureService.getOne(req.params.id, req.user!.id);
    res.json({ success: true, data: feature });
  },
);

export const updateFeatureStatus = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateFeatureStatusSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const feature = await FeatureService.updateStatus(
      req.params.id,
      req.user!.id,
      req.user!.role,
      parsed.data,
    );
    res.json({ success: true, data: feature });
  },
);

export const deleteFeatureRequest = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await FeatureService.delete(req.params.id, req.user!.id, req.user!.role);
    res.json({ success: true, message: "Feature request deleted" });
  },
);

export const castVote = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = castVoteSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const result = await FeatureService.vote(
      req.params.id,
      req.user!.id,
      parsed.data.type,
    );
    res.json({ success: true, ...result });
  },
);

export const removeVote = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await FeatureService.removeVote(req.params.id, req.user!.id);
    res.json({ success: true });
  },
);

export const getAdminContext = async (req: AuthRequest, res: Response) => {
    // Mirror `requireFocuraAdmin`: the dashboard is only usable when the caller
    // is both an ADMIN-role user AND registered in FOCURA_ADMIN_IDS. Checking
    // the env list alone made the frontend gate say "admin" while every admin
    // API still returned 403 (role mismatch) — the confusing state this fixes.
    res.json({
      success: true,
      isAdmin: isFocuraAdminUser(req.user!.role, req.user!.id),
    });
  }
;
