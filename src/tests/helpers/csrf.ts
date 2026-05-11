import crypto from 'crypto';
import type { TestUser } from './auth.js';

/**
 * CSRF Token Management for Tests
 * 
 * NOTE: For most use cases, import authWithCsrfHeaders from './auth.js' instead.
 * These utilities are provided for advanced scenarios.
 */

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_TTL = 3600; // 1 hour

/**
 * Generate a CSRF token for a test user
 * Mirrors the production generateCsrfToken but works in test environment
 */
export async function generateTestCsrfToken(
  userId: string,
  sessionId: string = 'test-session'
): Promise<string> {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('base64url');
  const key = `csrf:${userId}:${sessionId}`;
  
  // Try Redis first (if available in test environment)
  try {
    const { redis } = await import('../../lib/redis.js');
    
    if (redis && process.env.UPSTASH_REDIS_REST_URL) {
      try {
        await redis.setex(key, CSRF_TOKEN_TTL, token);
        return token;
      } catch (error) {
        // Redis operation failed, continue to fallback
      }
    }
  } catch {
    // Redis module not available
  }
  
  // Fallback to in-memory storage
  if (!global._testCsrfTokens) {
    global._testCsrfTokens = new Map<string, string>();
  }
  
  global._testCsrfTokens.set(key, token);
  
  // Auto-cleanup after TTL
  setTimeout(() => {
    global._testCsrfTokens?.delete(key);
  }, CSRF_TOKEN_TTL * 1000);
  
  return token;
}

// Declare global type for TypeScript
declare global {
  var _testCsrfTokens: Map<string, string> | undefined;
}

/**
 * Create CSRF headers for test requests
 * Use this in combination with authHeaders()
 * 
 * @example
 * const headers = { ...authHeaders(user), ...(await csrfHeaders(user.id)) };
 * await request(app).post('/api/tasks').set(headers).send(data);
 */
export async function csrfHeaders(
  userId: string,
  sessionId: string = 'test-session'
): Promise<{ 'x-csrf-token': string }> {
  const token = await generateTestCsrfToken(userId, sessionId);
  return { 'x-csrf-token': token };
}

/**
 * Cleanup all test CSRF tokens
 * Call this in beforeEach/afterEach if needed
 */
export function clearTestCsrfTokens(): void {
  if (global._testCsrfTokens) {
    global._testCsrfTokens.clear();
  }
}

/**
 * Check if CSRF protection is enabled
 * Returns false in test environment without Redis
 */
export function isCsrfEnabled(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Get combined auth + CSRF headers for POST/PUT/PATCH/DELETE requests
 * 
 * RECOMMENDED: Import this from './auth.js' instead to avoid circular dependencies
 * This re-export is provided for convenience only.
 * 
 * @example
 * import { authWithCsrfHeaders } from '../helpers/auth'; // RECOMMENDED
 * // OR
 * import { authWithCsrfHeaders } from '../helpers/csrf'; // ALSO WORKS
 * 
 * const headers = await authWithCsrfHeaders(user);
 * await request(app).post('/api/tasks').set(headers).send(data);
 */
export async function authWithCsrfHeaders(
  user: TestUser,
  sessionId: string = 'test-session'
): Promise<{ Authorization: string; 'x-csrf-token': string }> {
  // Import from auth.js to avoid duplication
  const { authWithCsrfHeaders: authWithCsrf } = await import('./auth.js');
  return authWithCsrf(user, { sessionId });
}

/**
 * Mock CSRF middleware for tests
 * Use this to completely bypass CSRF in specific test files if needed
 * 
 * @example
 * import { mockCsrfMiddleware } from '../helpers/csrf';
 * 
 * beforeAll(() => {
 *   mockCsrfMiddleware();
 * });
 */
export function mockCsrfMiddleware(): void {
  try {
    const csrfModule = require('../../middleware/csrf.js');
    
    // Replace requireCsrfToken with a pass-through middleware
    csrfModule.requireCsrfToken = () => (req: any, res: any, next: any) => next();
    
    console.warn('⚠️  CSRF middleware mocked for tests');
  } catch (error) {
    console.error('Failed to mock CSRF middleware:', error);
  }
}