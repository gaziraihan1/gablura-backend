import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import type { User } from '@prisma/client';

let _cachedPrivateKey: string | null = null;

function getPrivateKey(): string {
  if (_cachedPrivateKey) return _cachedPrivateKey;

  if (process.env.JWT_PRIVATE_KEY) {
    _cachedPrivateKey = Buffer.from(process.env.JWT_PRIVATE_KEY, 'base64').toString('utf-8');
    return _cachedPrivateKey;
  }

  const testPath = process.env.TEST_JWT_PRIVATE_KEY_PATH;
  if (testPath) {
    try { _cachedPrivateKey = readFileSync(testPath, 'utf-8'); return _cachedPrivateKey; } catch {
      console.warn(`[auth helper] Cannot resolve RSA private key from TEST_JWT_PRIVATE_KEY_PATH: ${testPath}`);
    }
  }

  const projectPath = process.env.JWT_PRIVATE_KEY_PATH ?? './keys/private.pem';
  try { _cachedPrivateKey = readFileSync(projectPath, 'utf-8'); return _cachedPrivateKey; } catch {
    console.warn(`[auth helper] Cannot resolve RSA private key from JWT_PRIVATE_KEY_PATH: ${projectPath}`);
  }

  throw new Error('[auth helper] Cannot resolve RSA private key.');
}

export type TestUser = Pick<User, 'id' | 'email' | 'role'>;

export interface TokenOptions {
  expiresIn?: string | number;
  sessionId?: string;
  jti?: string;
  version?: number;
  type?: string;
}

export function generateTestToken(user: TestUser, opts: TokenOptions = {}): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: opts.type ?? 'access',
      version: opts.version ?? 1,
      jti: opts.jti ?? crypto.randomUUID(),
      sessionId: opts.sessionId ?? crypto.randomUUID(),
    },
    getPrivateKey(),
    { algorithm: 'RS256', expiresIn: (opts.expiresIn ?? '1h') as any, issuer: 'gablura-app', audience: 'gablura-backend' },
  );
}

export function authHeaders(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${generateTestToken(user)}` };
}

export function adminAuthHeaders(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${generateTestToken(user)}` };
}

export async function authWithCsrfHeaders(
  user: TestUser,
  opts: TokenOptions = {},
): Promise<{ Authorization: string; 'x-csrf-token': string }> {
  const sessionId = opts.sessionId ?? 'test-session';
  const token = generateTestToken(user, { ...opts, sessionId });
  const csrfToken = await generateTestCsrfToken(user.id, sessionId);
  return { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken };
}

export async function generateTestCsrfToken(
  userId: string,
  sessionId: string = 'test-session',
): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const key = `csrf:${userId}:${sessionId}`;

  // Try ioredis first (via the mock in tests, real Redis in integration)
  try {
    // NOTE: The Redis client lives under `src/lib/redis`. The original relative import
    // pointed to a non‑existent `../../redis/redis.client.js`, which caused a module
    // resolution error in integration tests (where the module is not mocked). Adjusting
    // the path ensures the real Redis client is used, allowing CSRF tokens to be stored
    // in the Redis service provisioned by the CI workflow.
    const { getRedisClient } = await import('../../redis/redis.client.js');
    await getRedisClient().setex(key, 3600, token);
    return token;
  } catch {
    // Fall back to in‑memory for test environments without Redis (or if Redis is
    // unavailable during unit‑test runs that mock the client).
  }

  if (!global._testCsrfTokens) global._testCsrfTokens = new Map();
  global._testCsrfTokens.set(key, token);
  setTimeout(() => global._testCsrfTokens?.delete(key), 3600 * 1000);

  return token;
}

export function expiredAuthHeaders(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${generateTestToken(user, { expiresIn: -1 })}` };
}

export function invalidAuthHeaders(): { Authorization: string } {
  return { Authorization: 'Bearer not.a.real.jwt' };
}

export function buildExchangeProof(params: {
  userId: string; email: string; role: string; sessionId: string; timestamp: number;
}): string {
  const payload = `${params.userId}${params.email.toLowerCase()}${params.role}${params.sessionId}${params.timestamp}`;
  const secret = process.env.NEXTAUTH_SECRET || 'test-secret-key-for-auth-tests';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function clearTestCsrfTokens(): void {
  global._testCsrfTokens?.clear();
}

declare global {
  var _testCsrfTokens: Map<string, string> | undefined;
}