import { describe, it, expect } from "vitest";
import { limitApiRequest } from "../../../lib/limiter.js";

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
});
