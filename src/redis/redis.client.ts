import { Redis } from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client) return client;

  client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    enableReadyCheck: true,
    lazyConnect: false,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
  });

  client.on("error", (err: Error) => console.error("[Redis] error:", err));
  client.on("ready", () => console.log("[Redis] connected"));
  client.on("close", () => console.warn("[Redis] connection closed"));

  return client;
}

export const BILLING_CACHE = {
  subKey: (workspaceId: string) => `billing:sub:${workspaceId}`,
  limitsKey: (planName: string) => `billing:limits:${planName}`,
  invoiceKey: (workspaceId: string) => `billing:invoices:${workspaceId}`,
  userWsLimitKey: (userId: string) => `billing:user-ws-limit:${userId}`,
  // Cache version to prevent stale data after deployments
  versionKey: () => `billing:version`,

  SUB_TTL: 300, // 5 minutes - moderate for subscription status
  LIMITS_TTL: 3600, // 1 hour - plan limits change rarely
  INVOICE_TTL: 120, // 2 minutes - invoices change infrequently
  USER_WS_LIMIT_TTL: 300, // 5 minutes - user limits change occasionally
  CACHE_VERSION: process.env.BILLING_CACHE_VERSION || 'v1',

  async getSubscription(workspaceId: string) {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(BILLING_CACHE.subKey(workspaceId));
      if (!raw) return null;
      
      const data = JSON.parse(raw);
      // Validate cache has expected structure
      if (!data || !data.workspaceId || !data.planName || !data.status) {
        console.warn(`[BillingCache] Invalid subscription cache structure for ${workspaceId}, skipping cache`);
        return null;
      }
      
      // Additional safety: validate status is valid
      const validStatuses = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE'];
      if (!validStatuses.includes(data.status)) {
        console.warn(`[BillingCache] Invalid subscription status ${data.status} for ${workspaceId}, skipping cache`);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error(`[BillingCache] Error getting subscription cache for ${workspaceId}:`, error);
      return null; // Fail safely - return null to trigger DB fetch
    }
  },

  async setSubscription(workspaceId: string, data: unknown) {
    try {
      const redis = getRedisClient();
      // Add cache version to data for safety
      const dataWithVersion = { ...data as any, _cacheVersion: BILLING_CACHE.CACHE_VERSION };
      await redis.setex(
        BILLING_CACHE.subKey(workspaceId),
        BILLING_CACHE.SUB_TTL,
        JSON.stringify(dataWithVersion),
      );
    } catch (error) {
      console.error(`[BillingCache] Error setting subscription cache for ${workspaceId}:`, error);
      // Don't throw - caching failure shouldn't break billing
    }
  },

  async getPlanLimits(planName: string) {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(BILLING_CACHE.limitsKey(planName));
      if (!raw) return null;
      
      const data = JSON.parse(raw);
      // Validate cache version
      if (data._cacheVersion !== BILLING_CACHE.CACHE_VERSION) {
        console.warn(`[BillingCache] Cache version mismatch for plan ${planName}, skipping cache`);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error(`[BillingCache] Error getting plan limits cache for ${planName}:`, error);
      return null; // Fail safely
    }
  },

  async setPlanLimits(planName: string, data: unknown) {
    try {
      const redis = getRedisClient();
      const dataWithVersion = { ...data as any, _cacheVersion: BILLING_CACHE.CACHE_VERSION };
      await redis.setex(
        BILLING_CACHE.limitsKey(planName),
        BILLING_CACHE.LIMITS_TTL,
        JSON.stringify(dataWithVersion),
      );
    } catch (error) {
      console.error(`[BillingCache] Error setting plan limits cache for ${planName}:`, error);
    }
  },

  async invalidateWorkspace(workspaceId: string, ownerId?: string) {
    try {
      const redis = getRedisClient();
      const keys = [
        BILLING_CACHE.subKey(workspaceId),
        BILLING_CACHE.invoiceKey(workspaceId),
      ];
      if (ownerId) keys.push(BILLING_CACHE.userWsLimitKey(ownerId));
      
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[BillingCache] Invalidated cache for workspace ${workspaceId}`);
      }
    } catch (error) {
      console.error(`[BillingCache] Error invalidating workspace cache for ${workspaceId}:`, error);
      // Don't throw - invalidation failure shouldn't break billing flow
    }
  },

  async getUserWsLimit(userId: string): Promise<number | null> {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(BILLING_CACHE.userWsLimitKey(userId));
      if (raw === null) return null;
      
      const limit = JSON.parse(raw);
      // Validate it's a number
      if (typeof limit !== 'number' || isNaN(limit)) {
        console.warn(`[BillingCache] Invalid user workspace limit cache for ${userId}, skipping cache`);
        return null;
      }
      
      return limit;
    } catch (error) {
      console.error(`[BillingCache] Error getting user workspace limit cache for ${userId}:`, error);
      return null; // Fail safely
    }
  },

  async setUserWsLimit(userId: string, limit: number) {
    try {
      const redis = getRedisClient();
      await redis.setex(
        BILLING_CACHE.userWsLimitKey(userId),
        BILLING_CACHE.USER_WS_LIMIT_TTL,
        JSON.stringify(limit),
      );
    } catch (error) {
      console.error(`[BillingCache] Error setting user workspace limit cache for ${userId}:`, error);
    }
  },

  // New: Comprehensive invalidation for user across all workspaces
  async invalidateUser(userId: string) {
    try {
      const redis = getRedisClient();
      await redis.del(BILLING_CACHE.userWsLimitKey(userId));
      console.log(`[BillingCache] Invalidated user cache for ${userId}`);
    } catch (error) {
      console.error(`[BillingCache] Error invalidating user cache for ${userId}:`, error);
    }
  },

  // New: Invalidate all plan limits (useful after plan configuration changes)
  async invalidateAllPlanLimits() {
    try {
      const redis = getRedisClient();
      const pattern = 'billing:limits:*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[BillingCache] Invalidated ${keys.length} plan limit caches`);
      }
    } catch (error) {
      console.error('[BillingCache] Error invalidating all plan limits:', error);
    }
  },

  // New: Health check for billing cache
  async healthCheck(): Promise<{ healthy: boolean; errors: string[] }> {
    const errors: string[] = [];
    try {
      const redis = getRedisClient();
      await redis.ping();
    } catch {
      errors.push('Redis connection failed');
    }
    return {
      healthy: errors.length === 0,
      errors,
    };
  },
};
