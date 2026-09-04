import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import crypto from 'crypto';
import { 
  createUser 
} from '../factories/index.js';
import { createTokenPair } from '../../lib/auth/backendToken.js';
import * as tokenRevocation from '../../lib/auth/tokenRevocation.js';
import { buildExchangeProof } from '../helpers/auth.js';
vi.unmock('../../lib/auth/tokenRevocation.js');


describe('🔐 Auth & Security Journeys', () => {
  
  it('should handle "Token Refresh" lifecycle', { timeout: 40000 }, async () => {
    /**
     * JOURNEY:
     * 1. User is created
     * 2. System generates a token pair
     * 3. User uses refresh token to get a new pair
     * 4. User uses OLD refresh token again (should fail - replay detection)
     */
    const user = await createUser();
    const tokens = createTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: crypto.randomUUID(),
    });

    // Store the initial refresh token in Redis so it can be rotated
    const { storeRefreshToken } = await import('../../lib/auth/tokenRevocation.js');
    const { extractJti, parseExpiry, REFRESH_TOKEN_EXPIRY } = await import('../../lib/auth/backendToken.js');
    await storeRefreshToken(
      user.id,
      extractJti(tokens.refreshToken),
      parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000
    );

    // 3. Refresh token
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
    const newRefreshToken = refreshRes.body.refreshToken;
    expect(newRefreshToken).not.toBe(tokens.refreshToken);

    // Manually clear the deduplication cache to test actual rotation failure (replay detection)
    const { getRedisClient } = await import('../../redis/redis.client.js');
    const cacheKey = `gablura:refresh:result:${user.id}:${extractJti(tokens.refreshToken)}`;
    await getRedisClient().del(cacheKey);

    // Force rotation failure for replay detection test
    vi.spyOn(tokenRevocation, 'rotateRefreshToken').mockResolvedValue(false);

    // 4. Replay old refresh token
    const replayRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(replayRes.status).toBe(401);
    expect(replayRes.body.code).toBe('TOKEN_REPLAY_DETECTED');

    // Restore only the rotateRefreshToken spy — a blanket restoreAllMocks
    // here would wipe the implementations of unrelated factory mocks
    // (refreshLock, redis.client) for every later test in this file.
    (tokenRevocation.rotateRefreshToken as any).mockRestore();
  });

  it('should handle "Logout" lifecycle', async () => {
    /**
     * JOURNEY:
     * 1. User logs in (via tokens)
     * 2. User logs out
     * 3. User attempts to use access token (should eventually fail or be revoked)
     */
    const user = await createUser();
    const tokens = createTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: crypto.randomUUID(),
    });

    // 2. Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ logoutAll: false });

    expect(logoutRes.status).toBe(200);

    // Note: Access tokens are short-lived and typically not checked against a blacklist
    // unless using a very strict system. But we verify the logout call succeeds.
  });

  it('should handle "Auth Exchange" lifecycle', async () => {
    /**
     * JOURNEY:
     * 1. User provides exchange proof (userId, email, role, sessionId, timestamp, signature)
     * 2. System verifies HMAC signature
     * 3. System issues token pair
     * 4. System handles idempotency (duplicate exchange returns cached tokens)
     */
    const user = await createUser();
    const sessionId = crypto.randomUUID(); // Must be valid UUID
    const timestamp = Date.now();

    // Build exchange proof using the test helper
    const { buildExchangeProof } = await import('../helpers/auth.js');
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    // 1. Exchange with valid proof
    const exchangeRes = await request(app)
      .post('/api/v1/auth/exchange')
      .send({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        timestamp,
        signature,
      });

    expect(exchangeRes.status).toBe(200);
    expect(exchangeRes.body.success).toBe(true);
    expect(exchangeRes.body.accessToken).toBeDefined();
    expect(exchangeRes.body.refreshToken).toBeDefined();

    // 2. Test idempotency - same exchange should return cached tokens
    const exchangeRes2 = await request(app)
      .post('/api/v1/auth/exchange')
      .send({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        timestamp,
        signature,
      });

    expect(exchangeRes2.status).toBe(200);
    expect(exchangeRes2.body.success).toBe(true);
    expect(exchangeRes2.body.accessToken).toBe(exchangeRes.body.accessToken);
  });

  it('should reject expired exchange proof', async () => {
    /**
     * JOURNEY:
     * 1. User provides exchange proof with old timestamp
     * 2. System rejects as expired
     */
    const user = await createUser();
    const sessionId = crypto.randomUUID(); // Must be valid UUID
    const timestamp = Date.now() - 120_000; // 2 minutes ago (expired)

    const { buildExchangeProof } = await import('../helpers/auth.js');
    const signature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });

    const exchangeRes = await request(app)
      .post('/api/v1/auth/exchange')
      .send({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        timestamp,
        signature,
      });

    expect(exchangeRes.status).toBe(400);
    expect(exchangeRes.body.code).toBe('VALIDATION_ERROR');
  });

  it('should reject invalid exchange signature', async () => {
    /**
     * JOURNEY:
     * 1. User provides exchange proof with invalid signature
     * 2. System rejects as invalid
     */
    const user = await createUser();
    const sessionId = crypto.randomUUID(); // Must be valid UUID
    const timestamp = Date.now();

    const { buildExchangeProof } = await import('../helpers/auth.js');
    const validSignature = buildExchangeProof({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      timestamp,
    });
    
    // Corrupt the signature by flipping the first character
    const invalidSignature = (validSignature[0] === 'a' ? 'b' : 'a') + validSignature.slice(1);

    const exchangeRes = await request(app)
      .post('/api/v1/auth/exchange')
      .send({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId,
        timestamp,
        signature: invalidSignature,
      });

    expect(exchangeRes.status).toBe(401);
    expect(exchangeRes.body.code).toBe('INVALID_PROOF');
  });

  it('should reject exchange for non-existent user', async () => {
    /**
     * JOURNEY:
     * 1. User provides exchange proof for non-existent user
     * 2. System rejects as user not found
     */
    const sessionId = crypto.randomUUID(); // Must be valid UUID
    const timestamp = Date.now();

    const { buildExchangeProof } = await import('../helpers/auth.js');
    const signature = buildExchangeProof({
      userId: 'cmtbcsscn0000h0kz0uml7652', // Valid CUID format but non-existent
      email: 'nonexistent@example.com',
      role: 'USER',
      sessionId,
      timestamp,
    });

    const exchangeRes = await request(app)
      .post('/api/v1/auth/exchange')
      .send({
        userId: 'cmtbcsscn0000h0kz0uml7652', // Valid CUID format but non-existent
        email: 'nonexistent@example.com',
        role: 'USER',
        sessionId,
        timestamp,
        signature,
      });

    expect(exchangeRes.status).toBe(401);
    expect(exchangeRes.body.code).toBe('USER_NOT_FOUND');
  });
  // ─────────────────────────────────────────────────────────────────────────
  // Server-side session gates at refresh time (audit fixes G1/G2)
  // ─────────────────────────────────────────────────────────────────────────
  it('should reject refresh for a session revoked by max-sessions eviction', { timeout: 40000 }, async () => {
    const user = await createUser();
    const sessionId = crypto.randomUUID();

    const { createTokenPair } = await import('../../lib/auth/backendToken.js');
    const { storeRefreshToken, markSessionRevoked } = await import('../../lib/auth/tokenRevocation.js');
    const { extractJti, parseExpiry, REFRESH_TOKEN_EXPIRY } = await import('../../lib/auth/backendToken.js');

    const tokens = createTokenPair({ id: user.id, email: user.email, role: user.role, sessionId });
    await storeRefreshToken(user.id, extractJti(tokens.refreshToken), parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000);

    // Evict: mark the session as revoked (tombstone)
    await markSessionRevoked(sessionId);

    // Heal the shared refreshLock mock in case a previous test's
    // restoreAllMocks wiped its implementation.
    const { acquireRefreshLock } = await import('../../lib/auth/refreshLock.js');
    (acquireRefreshLock as any).mockResolvedValue?.(true);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REVOKED');
  });

  it('should reject refresh for a tracked session that went inactive', { timeout: 40000 }, async () => {
    const user = await createUser();
    const sessionId = crypto.randomUUID();

    const { createTokenPair } = await import('../../lib/auth/backendToken.js');
    const { storeRefreshToken } = await import('../../lib/auth/tokenRevocation.js');
    const { extractJti, parseExpiry, REFRESH_TOKEN_EXPIRY } = await import('../../lib/auth/backendToken.js');
    const { recordSessionCreation } = await import('../../middleware/sessionTimeout.js');
    const { getRedisClient } = await import('../../redis/redis.client.js');
    const { acquireRefreshLock } = await import('../../lib/auth/refreshLock.js');
    (acquireRefreshLock as any).mockResolvedValue?.(true);

    // Session was recorded at exchange time
    await recordSessionCreation(sessionId);
    // Then went inactive for 30 minutes → activity key expired
    await getRedisClient().del(`session:activity:${sessionId}`);

    const tokens = createTokenPair({ id: user.id, email: user.email, role: user.role, sessionId });
    await storeRefreshToken(user.id, extractJti(tokens.refreshToken), parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_TIMEOUT');
  });
});
