import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingController } from "../../../modules/billing/billing.controller.js";
import { BillingService } from "../../../modules/billing/billing.service.js";
import { prisma } from "../../../lib/prisma.js";
import { BadRequestError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/billing/billing.service.js", () => ({
  BillingService: {
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    getWorkspaceSubscription: vi.fn(),
    changePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    reactivateSubscription: vi.fn(),
    getInvoices: vi.fn(),
  },
}));

describe("BillingController", () => {
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResponse = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };
    mockRequest = {
      params: { workspaceId: "ws-123" },
      user: { id: "user-123" },
      body: {},
      query: {},
    };
  });

  describe("createCheckoutSession", () => {
    it("should create checkout session successfully", async () => {
      mockRequest.body = { planName: "PRO", billingCycle: "MONTHLY" };
      (prisma.workspace.findUniqueOrThrow as any).mockResolvedValue({ slug: "test-ws" });
      (BillingService.createCheckoutSession as any).mockResolvedValue("https://checkout.url");

      await BillingController.createCheckoutSession(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { url: "https://checkout.url" },
      });
    });

    it("should call next with BadRequestError for invalid planName", async () => {
      mockRequest.body = { planName: "INVALID" };
      const nextFunction = vi.fn();
      
      await BillingController.createCheckoutSession(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadRequestError));
    });

    it("should call next with BadRequestError for missing planName", async () => {
      mockRequest.body = {};
      const nextFunction = vi.fn();
      
      await BillingController.createCheckoutSession(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadRequestError));
    });
  });

  describe("createPortalSession", () => {
    it("should create portal session successfully", async () => {
      (prisma.workspace.findUniqueOrThrow as any).mockResolvedValue({ slug: "test-ws" });
      (BillingService.createPortalSession as any).mockResolvedValue("https://portal.url");

      await BillingController.createPortalSession(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { url: "https://portal.url" },
      });
    });
  });

  describe("getSubscription", () => {
    it("should return subscription if it exists", async () => {
      const sub = { planName: "PRO", status: "ACTIVE" };
      (prisma.workspace.findUnique as any).mockResolvedValue({ ownerId: "user-123" });
      (BillingService.getWorkspaceSubscription as any).mockResolvedValue(sub);

      await BillingController.getSubscription(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: sub,
      });
    });

    it("should return default FREE subscription if none exists", async () => {
      (prisma.workspace.findUnique as any).mockResolvedValue({ ownerId: "user-123" });
      (BillingService.getWorkspaceSubscription as any).mockResolvedValue(null);

      await BillingController.getSubscription(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: {
          workspaceId: "ws-123",
          planName: "FREE",
          status: "ACTIVE",
        },
      });
    });
  });

  describe("changePlan", () => {
    it("should change plan successfully", async () => {
      mockRequest.body = { newPlanName: "BUSINESS", billingCycle: "YEARLY" };
      const result = { success: true, message: "Plan changed" };
      (BillingService.changePlan as any).mockResolvedValue(result);

      await BillingController.changePlan(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: result,
      });
    });

    it("should call next with BadRequestError for invalid newPlanName", async () => {
      mockRequest.body = { newPlanName: "INVALID" };
      const nextFunction = vi.fn();
      
      await BillingController.changePlan(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(BadRequestError));
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription successfully", async () => {
      mockRequest.body = { immediately: true, reason: "too expensive" };
      const result = { cancelAtPeriodEnd: false };
      (BillingService.cancelSubscription as any).mockResolvedValue(result);

      await BillingController.cancelSubscription(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: result,
      });
    });
  });

  describe("reactivateSubscription", () => {
    it("should reactivate subscription successfully", async () => {
      (BillingService.reactivateSubscription as any).mockResolvedValue(undefined);

      await BillingController.reactivateSubscription(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { reactivated: true },
      });
    });
  });

  describe("getInvoices", () => {
    it("should get invoices successfully", async () => {
      mockRequest.query = { limit: "10" };
      const invoices = [{ id: "inv_1", amount: 100 }];
      (BillingService.getInvoices as any).mockResolvedValue(invoices);

      await BillingController.getInvoices(mockRequest, mockResponse, () => {});

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: invoices,
      });
    });
  });
});
