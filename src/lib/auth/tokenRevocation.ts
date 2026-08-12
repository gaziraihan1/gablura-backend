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
  try {
    const redis = getRedisClient();
    const oldKey = refreshTokenKey(userId, oldJti);
    const newKey = refreshTokenKey(userId, newJti);
    const indexKey = refreshIndexKey(userId);

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
  } catch (err) {
    console.error("[TokenRevocation] Failed to rotate refresh token:", err);
    return false;
  }
}

export async function storeSseToken(jti: string, userId: string): Promise<void> {
  try {
    // TTL is derived from the token's own expiry (30s) so the two can never
    // drift apart when SSE_TOKEN_EXPIRY changes.
    await getRedisClient().setex(
      `focura:sse:${jti}`,
      parseExpiry(SSE_TOKEN_EXPIRY) / 1000,
      userId,
    );
  } catch (err) {
    console.error("[TokenRevocation] Failed to store SSE token:", err);
  }
}

export async function consumeSseToken(jti: string): Promise<string | null> {
  try {
    const redis = getRedisClient();
    const key = `focura:sse:${jti}`;
    // Atomic get-and-delete via Lua: exactly ONE concurrent stream connection
    // may consume the token. A naive get-then-del races — two replays could
    // both observe the key before either deletes it. Single round-trip, no
    // TOCTOU window, no extra commands.
    const userId = await redis.eval(
      `local v = redis.call("GET", KEYS[1])
       if v then redis.call("DEL", KEYS[1]) end
       return v`,
      1,
      key,
    );
    return typeof userId === "string" ? userId : null;
  } catch (err) {
    console.error("[TokenRevocation] Failed to consume SSE token:", err);
    return null;
  }
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
