import { getRedisClient } from "../../redis/redis.client.js";

const REFRESH_LOCK_TTL_SECONDS = 45;

export async function acquireRefreshLock(sessionId: string): Promise<boolean> {
  try {
    const result = await getRedisClient().set(
      `gablura:refresh:lock:${sessionId}`,
      "1",
      "EX",
      REFRESH_LOCK_TTL_SECONDS,
      "NX",
    );
    return result === "OK";
  } catch (err) {
    console.error("[RefreshLock] Failed to acquire lock:", err);
    return true; // Fail open: allow refresh if Redis is down
  }
}

export async function releaseRefreshLock(sessionId: string): Promise<void> {
  try {
    await getRedisClient().del(`gablura:refresh:lock:${sessionId}`);
  } catch (err) {
    console.error("[RefreshLock] Failed to release lock:", err);
  }
}

export async function isRefreshLocked(sessionId: string): Promise<boolean> {
  try {
    const val = await getRedisClient().get(`gablura:refresh:lock:${sessionId}`);
    return !!val;
  } catch (err) {
    console.error("[RefreshLock] Failed to check lock status:", err);
    return false; // Fail open: treat as unlocked if Redis is down
  }
}
