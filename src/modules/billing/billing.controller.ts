import { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { BillingService } from "./billing.service.js";
import { BillingCycle } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler, BadRequestError } from "../../errors/index.js";

export class BillingController {
  static createCheckoutSession = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      const { planName, billingCycle = "MONTHLY" } = req.body as {
        planName: "PRO" | "BUSINESS";
        billingCycle?: BillingCycle;
      };

      if (!planName || !["PRO", "BUSINESS"].includes(planName)) {
        throw new BadRequestError("planName must be PRO or BUSINESS");
      }

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { slug: true },
      });

      const url = await BillingService.createCheckoutSession({
        workspaceId,
        workspaceSlug: workspace.slug,
        ownerId: req.user!.id,
        planName,
        billingCycle,
      });

      res.json({ success: true, data: { url } });
    },
  );

  static createPortalSession = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { slug: true },
      });

      const url = await BillingService.createPortalSession({
        workspaceId,
        workspaceSlug: workspace.slug,
        ownerId: req.user!.id,
      });

      res.json({ success: true, data: { url } });
    },
  );

  static getSubscription = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const sub = await BillingService.getWorkspaceSubscription(
        req.params.workspaceId,
      );
      res.json({
        success: true,
        data: sub ?? {
          workspaceId: req.params.workspaceId,
          planName: "FREE",
          status: "ACTIVE",
        },
      });
    },
  );

  static changePlan = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newPlanName, billingCycle } = req.body as {
      newPlanName: "FREE" | "PRO" | "BUSINESS";
      billingCycle?: BillingCycle;
    };

    if (!newPlanName || !["FREE", "PRO", "BUSINESS"].includes(newPlanName)) {
      throw new BadRequestError("Invalid newPlanName");
    }

    const result = await BillingService.changePlan({
      workspaceId: req.params.workspaceId,
      ownerId: req.user!.id,
      newPlanName,
      billingCycle,
    });

    res.json({
      success: true,
      data: result ?? { message: "Plan updated successfully" },
    });
  });

  static cancelSubscription = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { immediately = false, reason } = (req.body || {}) as {
        immediately?: boolean;
        reason?: string;
      };

      const result = await BillingService.cancelSubscription({
        workspaceId: req.params.workspaceId,
        ownerId: req.user!.id,
        immediately,
        reason,
      });

      res.json({ success: true, data: result });
    },
  );

  static reactivateSubscription = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      await BillingService.reactivateSubscription(
        req.params.workspaceId,
        req.user!.id,
      );
      res.json({ success: true, data: { reactivated: true } });
    },
  );

  static getInvoices = asyncHandler(async (req: AuthRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const invoices = await BillingService.getInvoices(
      req.params.workspaceId,
      req.user!.id,
      limit,
    );
    res.json({ success: true, data: invoices });
  });
}
