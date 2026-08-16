/**
 * modules/automation/automation.controller.ts
 */
import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import { AutomationQuery } from "./automation.query.js";
import { AutomationMutation } from "./automation.mutation.js";
import { AutomationAccess } from "./automation.access.js";
import { runRuleOnTask } from "../../queue/workers/automation.worker.js";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError } from "../../errors/index.js";
import {
  listAutomationsQuerySchema,
  createAutomationSchema,
  updateAutomationSchema,
  testAutomationSchema,
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

export const testAutomation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = testAutomationSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    // Only workspace OWNER/ADMIN can trigger a manual run.
    const rule = await AutomationAccess.getRuleForManager(req.user!.id, req.params.id);

    // The task must live in the rule's workspace.
    const task = await prisma.task.findFirst({
      where: { id: parsed.data.taskId, workspaceId: rule.workspaceId },
      select: { id: true },
    });
    if (!task) throw new NotFoundError("Task not found in this workspace");

    await runRuleOnTask(rule, task.id, req.user!.id);

    res.json({
      success: true,
      message: "Rule executed — changes applied to the task",
    });
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
