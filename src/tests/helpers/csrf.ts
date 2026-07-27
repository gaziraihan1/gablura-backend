import type { TestUser } from './auth.js';

export async function generateTestCsrfToken(
  userId: string,
  sessionId: string = 'test-session',
): Promise<string> {
  // Re-use the implementation from auth.ts to keep a single source of truth
  const { generateTestCsrfToken: gen } = await import('./auth.js');
  return gen(userId, sessionId);
}

export async function csrfHeaders(
  userId: string,
  sessionId: string = 'test-session',
): Promise<{ 'x-csrf-token': string }> {
  const token = await generateTestCsrfToken(userId, sessionId);
  return { 'x-csrf-token': token };
}

export async function authWithCsrfHeaders(
  user: TestUser,
  sessionId: string = 'test-session',
): Promise<{ Authorization: string; 'x-csrf-token': string }> {
  const { authWithCsrfHeaders: auth } = await import('./auth.js');
  return auth(user, { sessionId });
}

export function clearTestCsrfTokens(): void {
  global._testCsrfTokens?.clear();
}

// isCsrfEnabled no longer depends on Upstash — just check REDIS_URL
export function isCsrfEnabled(): boolean {
  return !!process.env.REDIS_URL;
}

export async function mockCsrfMiddleware(): Promise<void> {
  try {
    const csrfModule = await import('../../middleware/csrf.js');
    (csrfModule as any).requireCsrfToken = () => (req: any, res: any, next: any) => next();
    console.warn('⚠️  CSRF middleware mocked for tests');
  } catch (error) {
    console.error('Failed to mock CSRF middleware:', error);
  }
}

declare global {
  var _testCsrfTokens: Map<string, string> | undefined;
}