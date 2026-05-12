import { getRedisClient } from "../../redis/redis.client.js";

const REFRESH_LOCK_TTL_SECONDS = 45;

export async function acquireRefreshLock(sessionId: string): Promise<boolean> {
  const result = await getRedisClient().set(
    `focura:refresh:lock:${sessionId}`,
    "1",
    "EX",
    REFRESH_LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
}

export async function releaseRefreshLock(sessionId: string): Promise<void> {
  await getRedisClient().del(`focura:refresh:lock:${sessionId}`);
}

export async function isRefreshLocked(sessionId: string): Promise<boolean> {
  const val = await getRedisClient().get(`focura:refresh:lock:${sessionId}`);
  return !!val;
}