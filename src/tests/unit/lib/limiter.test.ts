import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../modules/billing/billing.service.js", () => ({
  BillingService: {
    getUserHighestPlan: vi.fn(),
  },
}));

import {
  limitApiRequest,
  limitCalendarRequest,
  resolveUserApiTier,
} from "../../../lib/limiter.js";
import { BillingService } from "../../../modules/billing/billing.service.js";

const mockGetUserHighestPlan = vi.mocked(BillingService.getUserHighestPlan);

describe("limitApiRequest", () => {
  const userId = "test-user";

  it("should allow requests under the limit (DevRateLimiter)", async () => {
    // Since we are likely in 'test' environment, it uses DevRateLimiter
    const result = await limitApiRequest(userId, "free");
    expect(result.success).toBe(true);
    expect(result.limit).toBe(60);
    expect(result.remaining).toBeLessThan(60);
  });

  it("should respect different tier limits", async () => {
    const proResult = await limitApiRequest("pro-user", "pro");
    expect(proResult.limit).toBe(300);

    const entResult = await limitApiRequest("ent-user", "enterprise");
    expect(entResult.limit).toBe(1000);
  });

  it("should eventually deny requests when limit is reached", async () => {
    const limitUser = "limit-user";
    const limit = 60;
    
    // We don't want to actually loop 61 times in a unit test if it's slow, 
    // but DevRateLimiter is very fast.
    for (let i = 0; i < limit; i++) {
      await limitApiRequest(limitUser, "free");
    }
    
    const result = await limitApiRequest(limitUser, "free");
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("uses a separate calendar bucket with higher limits", async () => {
    const calendarUser = "cal-user";

    // The calendar bucket starts fresh — it must not inherit the shared
    // bucket's usage for the same user.
    const freeResult = await limitCalendarRequest(calendarUser, "free");
    expect(freeResult.success).toBe(true);
    expect(freeResult.limit).toBe(120);

    const proResult = await limitCalendarRequest("cal-pro", "pro");
    expect(proResult.limit).toBe(600);

    const entResult = await limitCalendarRequest("cal-ent", "enterprise");
    expect(entResult.limit).toBe(2000);
  });

  it("denies calendar requests once the calendar bucket is exhausted", async () => {
    const calendarUser = "cal-limit";
    const limit = 120;

    for (let i = 0; i < limit; i++) {
      await limitCalendarRequest(calendarUser, "free");
    }

    const result = await limitCalendarRequest(calendarUser, "free");
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("keeps the calendar bucket independent from the shared API bucket", async () => {
    const sharedUser = "cal-independent";

    // Exhaust the calendar bucket for this user.
    for (let i = 0; i < 120; i++) {
      await limitCalendarRequest(sharedUser, "free");
    }

    // The shared API bucket for the same user must be unaffected.
    const result = await limitApiRequest(sharedUser, "free");
    expect(result.success).toBe(true);
  });
});

describe("resolveUserApiTier", () => {
  beforeEach(() => {
    mockGetUserHighestPlan.mockReset();
  });

  it("maps FREE to the free tier", async () => {
    mockGetUserHighestPlan.mockResolvedValue("FREE" as any);
    await expect(resolveUserApiTier("u-free")).resolves.toBe("free");
    expect(mockGetUserHighestPlan).toHaveBeenCalledWith("u-free");
  });

  it("maps PRO to the pro tier", async () => {
    mockGetUserHighestPlan.mockResolvedValue("PRO" as any);
    await expect(resolveUserApiTier("u-pro")).resolves.toBe("pro");
  });

  it("maps BUSINESS and ENTERPRISE to the enterprise tier", async () => {
    mockGetUserHighestPlan.mockResolvedValue("BUSINESS" as any);
    await expect(resolveUserApiTier("u-business")).resolves.toBe("enterprise");

    mockGetUserHighestPlan.mockResolvedValue("ENTERPRISE" as any);
    await expect(resolveUserApiTier("u-enterprise")).resolves.toBe("enterprise");
  });

  it("falls back to the free tier for unknown plans", async () => {
    mockGetUserHighestPlan.mockResolvedValue("MYSTERY_PLAN" as any);
    await expect(resolveUserApiTier("u-mystery")).resolves.toBe("free");
  });

  it("falls back to the free tier when the billing lookup fails", async () => {
    mockGetUserHighestPlan.mockRejectedValue(new Error("billing down"));
    await expect(resolveUserApiTier("u-down")).resolves.toBe("free");
  });

  it("caches the resolved tier for 60s (no repeated billing lookups)", async () => {
    mockGetUserHighestPlan.mockResolvedValue("PRO" as any);

    await resolveUserApiTier("u-cached");
    await resolveUserApiTier("u-cached");
    await resolveUserApiTier("u-cached");

    expect(mockGetUserHighestPlan).toHaveBeenCalledTimes(1);
  });
});
