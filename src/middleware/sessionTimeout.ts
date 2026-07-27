// ═══════════════════════════════════════════════════════════════
// Session Timeout Management Middleware
// ═══════════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import { getRedisClient } from '../redis/redis.client.js';
import { AuthRequest } from './auth.js';

// Configuration (in seconds)
const INACTIVITY_TIMEOUT = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT || '1800', 10); // 30 min
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
 * Check if session is valid
 */
async function isSessionValid(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const createdKey = `${SESSION_CREATED_PREFIX}${sessionId}`;
    
    // Check if absolute timeout expired
    const exists = await redis.exists(createdKey);
    return exists === 1;
  } catch (error) {
    console.error('❌ Failed to check session validity:', error);
    return false;
  }
}

/**
 * Check if session is inactive
 */
async function isSessionInactive(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const activityKey = `${SESSION_ACTIVITY_PREFIX}${sessionId}`;
    
    // Check if inactivity timeout expired
    const exists = await redis.exists(activityKey);
    return exists !== 1; // If key doesn't exist, session is inactive
  } catch (error) {
    console.error('❌ Failed to check session inactivity:', error);
    return true; // Assume inactive on error (safe default)
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
    const sessionId = req.user?.tokenJti;

    if (!sessionId) {
      return next();
    }

    // Check absolute timeout
    const isValid = await isSessionValid(sessionId);
    if (!isValid) {
      console.log(`⏰ Session expired (absolute): ${sessionId}`);
      return res.status(401).json({
        success: false,
        code: 'SESSION_TIMEOUT',
        message: 'Session expired. Please log in again.',
      });
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