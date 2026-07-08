import { getRedisClient } from "../../redis/redis.client.js";

// const devRevokedAccess = new Set<string>();
// const devRefreshTokens = new Map<string, string>();
// const devSseTokens = new Map<string, string>();

const refreshIndexKey = (userId: string) => `focura:refresh:index:${userId}`;
const refreshTokenKey = (userId: string, jti: string) => `focura:refresh:${userId}:${jti}`;

export async function revokeAccessToken(jti: string, expiresInSeconds: number): Promise<void> {
  await getRedisClient().setex(`focura:revoked:access:${jti}`, expiresInSeconds, "1");
}

export async function isAccessTokenRevoked(jti: string): Promise<boolean> {
  const val = await getRedisClient().get(`focura:revoked:access:${jti}`);
  return val === "1";
}

export async function storeRefreshToken(userId: string, jti: string, expiresInSeconds: number): Promise<void> {
  const redis = getRedisClient();
  const tokenKey = refreshTokenKey(userId, jti);
  await redis.setex(tokenKey, expiresInSeconds, JSON.stringify({ jti, createdAt: Date.now() }));
  await redis.sadd(refreshIndexKey(userId), tokenKey);
}

export async function isRefreshTokenValid(userId: string, jti: string): Promise<boolean> {
  const val = await getRedisClient().get(refreshTokenKey(userId, jti));
  return val !== null;
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  const redis = getRedisClient();
  const tokenKey = refreshTokenKey(userId, jti);
  await redis.del(tokenKey);
  await redis.srem(refreshIndexKey(userId), tokenKey);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const redis = getRedisClient();
  const idxKey = refreshIndexKey(userId);
  let keys = await redis.smembers(idxKey);

  if (keys.length === 0) {
    keys = await redis.keys(`focura:refresh:${userId}:*`);
  }

  if (keys.length > 0) await redis.del(...keys);
  await redis.del(idxKey);
}

export async function rotateRefreshToken(
  userId: string,
  oldJti: string,
  newJti: string,
  expiresInSeconds: number,
): Promise<boolean> {
  const redis = getRedisClient();
  const oldKey = refreshTokenKey(userId, oldJti);
  const newKey = refreshTokenKey(userId, newJti);
  const indexKey = refreshIndexKey(userId);

  const existsBefore = await redis.exists(oldKey);
  console.log("[rotateRefreshToken] entering", { oldKey, existsBefore, redisStatus: redis.status });

  const result = await redis.eval(
    `
    if redis.call("EXISTS", KEYS[1]) == 1 then
      redis.call("DEL", KEYS[1])
      redis.call("SETEX", KEYS[2], ARGV[1], ARGV[2])
      redis.call("SREM", KEYS[3], KEYS[1])
      redis.call("SADD", KEYS[3], KEYS[2])
      return 1
    else
      return 0
    end
    `,
    3,
    oldKey,
    newKey,
    indexKey,
    expiresInSeconds.toString(),
    JSON.stringify({ jti: newJti, createdAt: Date.now() }),
  );

  console.log("[rotateRefreshToken] result", { oldKey, result });

  return result === 1;
}

export async function storeSseToken(jti: string, userId: string): Promise<void> {
  await getRedisClient().setex(`focura:sse:${jti}`, 30, userId);
}

export async function consumeSseToken(jti: string): Promise<string | null> {
  const redis = getRedisClient();
  const key = `focura:sse:${jti}`;
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);
  return userId;
}