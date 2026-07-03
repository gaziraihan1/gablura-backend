import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../../../modules/billing/billing.service.js";
import { prisma } from "../../../lib/prisma.js";
import { getPaymentProvider } from "../../../payment/provider.registry.js";
import { BILLING_CACHE } from "../../../redis/redis.client.js";
import { ForbiddenError, NotFoundError, ConflictError } from "../../../errors/index.js";
import type { Workspace, User, Subscription } from "@prisma/client";
import type { WorkspaceSubscriptionResponse, CreateCheckoutInput } from "../../../modules/billing/billing.types.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    plan: {
      findUnique: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../payment/provider.registry.js", () => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("../../../redis/redis.client.js", () => ({
  BILLING_CACHE: {
    getSubscription: vi.fn(),
    setSubscription: vi.fn(),
    invalidateWorkspace: vi.fn(),
    invoiceKey: vi.fn((id) => `billing:invoices:${id}`),
  },
}));

vi.mock("../../../lib/redis/cache.client.js", () => ({
  UserCache: {
    invalidateUser: vi.fn(),
  },
}));

describe("BillingService", () => {
  const mockProvider = {
    createCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    changePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    reactivateSubscription: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getPaymentProvider).mockReturnValue(mockProvider as any);
  });

  describe("createCheckoutSession", () => {
    it("should create checkout session successfully", async () => {
      const input: CreateCheckoutInput = {
        workspaceId: "ws-123",
        workspaceSlug: "test-ws",
        ownerId: "user-123",
        planName: "PRO",
        billingCycle: "MONTHLY",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.spyOn(BillingService, 'getWorkspaceSubscription').mockResolvedValue(null);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        stripeCustomerId: "cus_123",
      } as unknown as User);
      mockProvider.createCheckoutSession.mockResolvedValue({ url: "https://checkout.url" });

      const url = await BillingService.createCheckoutSession(input);
      expect(url).toBe("https://checkout.url");
      expect(mockProvider.createCheckoutSession).toHaveBeenCalled();
    });

    it("should throw ForbiddenError if not owner", async () => {
      const input: CreateCheckoutInput = {
        workspaceId: "ws-123",
        workspaceSlug: "test-ws",
        ownerId: "user-123",
        planName: "PRO",
        billingCycle: "MONTHLY",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-456" } as unknown as Workspace);

      await expect(BillingService.createCheckoutSession(input)).rejects.toThrow(ForbiddenError);
    });

    it("should throw ConflictError if already on the plan", async () => {
      const input: CreateCheckoutInput = {
        workspaceId: "ws-123",
        workspaceSlug: "test-ws",
        ownerId: "user-123",
        planName: "PRO",
        billingCycle: "MONTHLY",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.spyOn(BillingService, 'getWorkspaceSubscription').mockResolvedValue({ planName: "PRO" } as unknown as WorkspaceSubscriptionResponse);

      await expect(BillingService.createCheckoutSession(input)).rejects.toThrow(ConflictError);
    });
  });

  describe("createPortalSession", async () => {
    it("should create portal session successfully", async () => {
      const input = {
        workspaceId: "ws-123",
        ownerId: "user-123",
        workspaceSlug: "test-ws",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ stripeCustomerId: "cus_123" } as unknown as User);
      mockProvider.createPortalSession.mockResolvedValue({ url: "https://portal.url" });

      const url = await BillingService.createPortalSession(input);
      expect(url).toBe("https://portal.url");
    });

    it("should throw NotFoundError if no customer id", async () => {
      const input = {
        workspaceId: "ws-123",
        ownerId: "user-123",
        workspaceSlug: "test-ws",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ stripeCustomerId: null } as unknown as User);

      await expect(BillingService.createPortalSession(input)).rejects.toThrow(NotFoundError);
    });
  });

  describe("getWorkspaceSubscription", () => {
    it("should return cached subscription", async () => {
      const cachedSub: WorkspaceSubscriptionResponse = { 
        workspaceId: "ws-123",
        planName: "PRO", 
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        trialEnd: null,
        stripeSubscriptionId: "sub_123",
      };
      vi.mocked(BILLING_CACHE.getSubscription).mockResolvedValue(cachedSub);

      const result = await BillingService.getWorkspaceSubscription("ws-123");
      expect(result).toEqual(cachedSub);
    });

    it("should fetch from DB and cache if not cached", async () => {
      vi.mocked(BILLING_CACHE.getSubscription).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        workspaceId: "ws-123",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        trialEnd: null,
        stripeSubscriptionId: "sub_123",
        plan: { name: "PRO" },
      } as unknown as Subscription);

      const result = await BillingService.getWorkspaceSubscription("ws-123");
      expect(result?.planName).toBe("PRO");
      expect(BILLING_CACHE.setSubscription).toHaveBeenCalled();
    });

    it("should return null if subscription is CANCELED", async () => {
      vi.mocked(BILLING_CACHE.getSubscription).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        workspaceId: "ws-123",
        status: "CANCELED",
        plan: { name: "PRO" },
      } as unknown as Subscription);

      const result = await BillingService.getWorkspaceSubscription("ws-123");
      expect(result).toBeNull();
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription successfully", async () => {
      const input = {
        workspaceId: "ws-123",
        ownerId: "user-123",
        immediately: false,
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        workspaceId: "ws-123",
        status: "ACTIVE",
        stripeSubscriptionId: "sub_123",
      } as unknown as Subscription);

      await BillingService.cancelSubscription(input);
      expect(mockProvider.cancelSubscription).toHaveBeenCalled();
      expect(BILLING_CACHE.invalidateWorkspace).toHaveBeenCalled();
    });

    it("should throw NotFoundError if no active subscription", async () => {
      const input = {
        workspaceId: "ws-123",
        ownerId: "user-123",
      };

      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

      await expect(BillingService.cancelSubscription(input)).rejects.toThrow(NotFoundError);
    });
  });

  describe("reactivateSubscription", () => {
    it("should reactivate subscription successfully", async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        workspaceId: "ws-123",
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: "sub_123",
      } as unknown as Subscription);

      await BillingService.reactivateSubscription("ws-123", "user-123");
      expect(mockProvider.reactivateSubscription).toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalled();
    });

    it("should throw NotFoundError if not pending cancellation", async () => {
      vi.mocked(prisma.workspace.findUniqueOrThrow).mockResolvedValue({ ownerId: "user-123" } as unknown as Workspace);
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
        workspaceId: "ws-123",
        cancelAtPeriodEnd: false,
      } as unknown as Subscription);

      await expect(BillingService.reactivateSubscription("ws-123", "user-123")).rejects.toThrow(NotFoundError);
    });
  });
});

