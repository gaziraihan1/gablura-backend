import { getRedisClient } from "../../redis/redis.client.js";
import { parseExpiry, SSE_TOKEN_EXPIRY } from "./backendToken.js";

const refreshIndexKey = (userId: string) => `focura:refresh:index:${userId}`;
const refreshTokenKey = (userId: string, jti: string) => `focura:refresh:${userId}:${jti}`;

export async function revokeAccessToken(jti: string, expiresInSeconds: number): Promise<void> {
  try {
    await getRedisClient().setex(`focura:revoked:access:${jti}`, expiresInSeconds, "1");
  } catch (err) {
    console.error("[TokenRevocation] Failed to revoke access token:", err);
  }
}

export async function isAccessTokenRevoked(jti: string): Promise<boolean> {
  try {
    const val = await getRedisClient().get(`focura:revoked:access:${jti}`);
    return val === "1";
  } catch (err) {
    console.error("[TokenRevocation] Failed to check revoked access token:", err);
    return false; // Fail open: treat as not revoked if Redis is down
  }
}

export async function storeRefreshToken(userId: string, jti: string, expiresInSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    const tokenKey = refreshTokenKey(userId, jti);
    await redis.setex(tokenKey, expiresInSeconds, JSON.stringify({ jti, createdAt: Date.now() }));
    await redis.sadd(refreshIndexKey(userId), tokenKey);
  } catch (err) {
    console.error("[TokenRevocation] Failed to store refresh token:", err);
  }
}

export async function isRefreshTokenValid(userId: string, jti: string): Promise<boolean> {
  try {
    const val = await getRedisClient().get(refreshTokenKey(userId, jti));
    return val !== null;
  } catch (err) {
    console.error("[TokenRevocation] Failed to check refresh token validity:", err);
    return false;
  }
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const tokenKey = refreshTokenKey(userId, jti);
    await redis.del(tokenKey);
    await redis.srem(refreshIndexKey(userId), tokenKey);
  } catch (err) {
    console.error("[TokenRevocation] Failed to revoke refresh token:", err);
  }
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const idxKey = refreshIndexKey(userId);
    let keys = await redis.smembers(idxKey);

    if (keys.length === 0) {
      keys = await redis.keys(`focura:refresh:${userId}:*`);
    }

    if (keys.length > 0) await redis.del(...keys);
    await redis.del(idxKey);
  } catch (err) {
    console.error("[TokenRevocation] Failed to revoke all refresh tokens:", err);
  }
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

  // NOTE: Redis errors propagate so the refresh endpoint can distinguish
  // "token not found" (result=0 → replay) from "Redis unavailable" (throw
  // → fail-open and issue new tokens). Previously both cases returned false,
  // causing a false TOKEN_REPLAY_DETECTED401 that logged users out after
  // 15 minutes whenever Upstash hit its request limit.
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

  return result === 1;
}

export async function storeSseToken(jti: string, userId: string): Promise<void> {
  // TTL is derived from the token's own expiry (30s) so the two can never
  // drift apart when SSE_TOKEN_EXPIRY changes.
  //
  // NOTE: Redis errors propagate so callers (exchange, refresh, getSseToken)
  // know the token was never persisted. Previously this swallowed errors and
  // returned the SSE token to the client anyway — when Redis was down the
  // token would always fail at stream-connect time.
  await getRedisClient().setex(
    `focura:sse:${jti}`,
    parseExpiry(SSE_TOKEN_EXPIRY) / 1000,
    userId,
  );
}

export async function consumeSseToken(jti: string): Promise<string | null> {
  const redis = getRedisClient();
  const key = `focura:sse:${jti}`;
  // Atomic get-and-delete via Lua: exactly ONE concurrent stream connection
  // may consume the token. A naive get-then-del races — two replays could
  // both observe the key before either deletes it. Single round-trip, no
  // TOCTOU window, no extra commands.
  //
  // NOTE: Redis errors propagate to the caller so the SSE stream handler
  // can distinguish "token not found" (401) from "Redis unavailable" (503).
  // Swallowing the error here caused a misleading TOKEN_REUSED 401 when the
  // real problem was Upstash rate-limit exhaustion.
  const userId = await redis.eval(
    `local v = redis.call("GET", KEYS[1])
     if v then redis.call("DEL", KEYS[1]) end
     return v`,
    1,
    key,
  );
  return typeof userId === "string" ? userId : null;
}

export async function markSessionRevoked(sessionId: string): Promise<void> {
  try {
    await getRedisClient().setex(
      `focura:session:revoked:${sessionId}`,
      7 * 24 * 60 * 60,
      "1",
    );
  } catch (err) {
    console.error("[TokenRevocation] Failed to mark session revoked:", err);
  }
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    const val = await getRedisClient().get(
      `focura:session:revoked:${sessionId}`,
    );
    return val === "1";
  } catch (err) {
    console.error("[TokenRevocation] Failed to check revoked session:", err);
    return false;
  }
}
