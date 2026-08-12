// ═══════════════════════════════════════════════════════════════
// Session Timeout Management Middleware
// ═══════════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import { getRedisClient } from '../redis/redis.client.js';
import { AuthRequest } from './auth.js';

// Configuration (in seconds)
// Inactivity timeout is aligned with the absolute session lifetime (7 days) so
// users stay logged in while they are actively on the site; only the absolute
// cap ends the session. Override via env if a shorter idle window is desired.
const INACTIVITY_TIMEOUT = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT || '604800', 10); // 7 days
const ABSOLUTE_TIMEOUT = parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT || '604800', 10); // 7 days

const SESSION_CREATED_PREFIX = 'session:created:';
const SESSION_ACTIVITY_PREFIX = 'session:activity:';

/**
 * Record session creation
 */
export async function recordSessionCreation(sessionId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const now = Date.now();

    // Absolute timeout (7 days)
    await redis.setex(
      `${SESSION_CREATED_PREFIX}${sessionId}`,
      ABSOLUTE_TIMEOUT,
      now.toString()
    );

    // Activity timeout (30 minutes, auto-resets on activity)
    await redis.setex(
      `${SESSION_ACTIVITY_PREFIX}${sessionId}`,
      INACTIVITY_TIMEOUT,
      now.toString()
    );

    console.log(`✅ Session recorded: ${sessionId}`);
  } catch (error) {
    console.error('❌ Failed to record session:', error);
    throw error;
  }
}

/**
 * Update session activity (called on every request)
 */
async function updateSessionActivity(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const now = Date.now();
    const key = `${SESSION_ACTIVITY_PREFIX}${sessionId}`;

    // Reset the TTL (refreshes 30-min counter)
    const result = await redis.setex(key, INACTIVITY_TIMEOUT, now.toString());
    return !!result;
  } catch (error) {
    console.error('❌ Failed to update session activity:', error);
    return false;
  }
}

/**
 * Whether a session was explicitly recorded by the exchange flow.
 * Untracked/legacy sessions (or sessions whose 7-day absolute lifetime
 * elapsed) are still bounded by their token lifetimes (15m access / 7d
 * refresh), so we fail open for them instead of force-logging-out every
 * existing user at rollout.
 */
export async function isSessionTracked(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    return (await redis.exists(`${SESSION_CREATED_PREFIX}${sessionId}`)) === 1;
  } catch (error) {
    console.error('❌ Failed to check session tracking:', error);
    // Fail open: treat as untracked when Redis is unavailable (consistent
    // with isAccessTokenRevoked failing open) so a Redis blip doesn't 401
    // every authenticated request.
    return false;
  }
}

/**
 * Check if session is inactive
 */
export async function isSessionInactive(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const activityKey = `${SESSION_ACTIVITY_PREFIX}${sessionId}`;
    
    // Check if inactivity timeout expired
    const exists = await redis.exists(activityKey);
    return exists !== 1; // If key doesn't exist, session is inactive
  } catch (error) {
    console.error('❌ Failed to check session inactivity:', error);
    // Fail open: treat as ACTIVE when Redis is unavailable so a Redis blip never
    // force-logs-out every authenticated user (isSessionTracked and the rest of
    // the auth stack already fail open on Redis errors).
    return false;
  }
}

/**
 * Session Timeout Middleware
 * - Checks absolute timeout (7 days)
 * - Checks inactivity timeout (30 min)
 * - Updates activity on each request
 */
export const sessionTimeout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const sessionId = req.user?.sessionId;

    if (!sessionId) {
      return next();
    }

    // Only enforce inactivity for sessions recorded by the exchange flow;
    // untracked sessions are bounded by their 15m access / 7d refresh tokens.
    const tracked = await isSessionTracked(sessionId);
    if (!tracked) {
      return next();
    }

    // Check inactivity timeout
    const isInactive = await isSessionInactive(sessionId);
    if (isInactive) {
      console.log(`⏰ Session expired (inactivity): ${sessionId}`);
      return res.status(401).json({
        success: false,
        code: 'SESSION_TIMEOUT',
        message: 'Session expired due to inactivity. Please log in again.',
      });
    }

    // Update activity (refresh the 30-min counter)
    await updateSessionActivity(sessionId);

    next();
  } catch (error) {
    console.error('❌ Session timeout check error:', error);
    return res.status(500).json({
      success: false,
      code: 'SESSION_ERROR',
      message: 'Session validation failed',
    });
  }
};

/**
 * Invalidate session (on logout)
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(`${SESSION_CREATED_PREFIX}${sessionId}`);
    await redis.del(`${SESSION_ACTIVITY_PREFIX}${sessionId}`);
    console.log(`✅ Session invalidated: ${sessionId}`);
  } catch (error) {
    console.error('❌ Failed to invalidate session:', error);
  }
}