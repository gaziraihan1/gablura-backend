/**
 * modules/automation/automation.controller.ts
 */
import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import { AutomationQuery } from "./automation.query.js";
import { AutomationMutation } from "./automation.mutation.js";
import {
  listAutomationsQuerySchema,
  createAutomationSchema,
  updateAutomationSchema,
} from "./automation.validators.js";

export const listAutomations = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = listAutomationsQuerySchema.safeParse(req.query);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const rules = await AutomationQuery.list(
      req.user!.id,
      parsed.data.workspaceId,
      parsed.data.projectId,
    );
    res.json({ success: true, data: rules });
  },
);

export const getAutomation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const rule = await AutomationQuery.getById(req.user!.id, req.params.id);
    res.json({ success: true, data: rule });
  },
);

export const getAutomationRuns = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const runs = await AutomationQuery.getRunHistory(
      req.user!.id,
      req.params.id,
    );
    res.json({ success: true, data: runs });
  },
);

export const createAutomation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createAutomationSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const rule = await AutomationMutation.create(req.user!.id, parsed.data);
    res
      .status(201)
      .json({ success: true, message: "Automation rule created", data: rule });
  },
);

export const updateAutomation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateAutomationSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const rule = await AutomationMutation.update(
      req.user!.id,
      req.params.id,
      parsed.data,
    );
    res.json({ success: true, message: "Automation rule updated", data: rule });
  },
);

export const deleteAutomation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const result = await AutomationMutation.remove(req.user!.id, req.params.id);
    res.json({
      success: true,
      message: "Automation rule deleted",
      data: result,
    });
  },
);
