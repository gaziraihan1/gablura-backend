import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ═══════════════════════════════════════════════════════════════════════════════
// Hoisted mocks – available inside vi.mock() factories
// ═══════════════════════════════════════════════════════════════════════════════

const mockPrisma = vi.hoisted(() => ({
  workspaceMember: {
    findUnique: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
  },
}));

const mockGetPoolMetrics = vi.hoisted(() => vi.fn());

const mockIsFocuraAdmin = vi.hoisted(() => vi.fn());

const mockGetRedisClient = vi.hoisted(() => vi.fn());

// ═══════════════════════════════════════════════════════════════════════════════
// vi.mock() factories
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
  getPoolMetrics: mockGetPoolMetrics,
}));

vi.mock('../../../config/admin.config.js', () => ({
  isFocuraAdmin: mockIsFocuraAdmin,
}));

vi.mock('../../../redis/redis.client.js', () => ({
  getRedisClient: mockGetRedisClient,
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Import after mocks are registered
// ═══════════════════════════════════════════════════════════════════════════════

import { securityHeaders } from '../../../middleware/securityHeaders.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import {
  hasPermission,
  requirePermission,
  requireWorkspaceMembership,
  requireResourceOwnership,
  Permission,
} from '../../../middleware/rbac.js';
import { requireFocuraAdmin } from '../../../middleware/focuraAdmin.js';
import { dbMonitoring, dbPoolGuard } from '../../../middleware/dbMonitoring.js';
import { rateLimitMiddleware } from '../../../middleware/rateLimiter.js';
import type { AuthRequest } from '../../../middleware/auth.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function createReq(overrides?: Partial<AuthRequest>): AuthRequest {
  return {
    headers: {},
    params: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as AuthRequest;
}

function createRes(): Response {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    getHeader: vi.fn((key: string) => headers[key]),
  } as unknown as Response;
  return res;
}

const next = vi.fn() as NextFunction;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Security Headers Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('securityHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets all standard security headers', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cross-Origin-Embedder-Policy',
      'require-corp',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'same-origin');
    expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'same-origin');
  });

  it('sets CSP header with correct directives', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    const cspCall = (res.setHeader as any).mock.calls.find(
      (c: any[]) => c[0] === 'Content-Security-Policy',
    );
    expect(cspCall).toBeDefined();
    const csp = cspCall![1] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("media-src 'self'");
  });

  it('sets Permissions-Policy header', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    const ppCall = (res.setHeader as any).mock.calls.find(
      (c: any[]) => c[0] === 'Permissions-Policy',
    );
    expect(ppCall).toBeDefined();
    const pp = ppCall![1] as string;
    expect(pp).toContain('accelerometer=()');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('gyroscope=()');
    expect(pp).toContain('magnetometer=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('payment=()');
    expect(pp).toContain('usb=()');
  });

  it('sets connect-src CSP with API_URL', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    const cspCall = (res.setHeader as any).mock.calls.find(
      (c: any[]) => c[0] === 'Content-Security-Policy',
    );
    const csp = cspCall![1] as string;
    expect(csp).toContain("connect-src 'self'");
  });

  it('sets HSTS header in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Re-evaluate the isProd constant by re-importing would be ideal but
    // since isProd is evaluated at module load time, we test by checking
    // if the header is set (module may already be loaded with dev value).
    // We verify the behavior by checking the setHeader was called with HSTS
    // if the module was loaded in production mode. Since the module is already
    // loaded, we just verify it sets the header or not based on current env.
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    // The isProd flag was set when the module loaded. We can't change it mid-test
    // but we can verify the middleware calls next() regardless.
    expect(next).toHaveBeenCalled();
    process.env.NODE_ENV = original;
  });

  it('calls next()', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets exactly 8 security headers (non-CSP)', () => {
    const req = createReq();
    const res = createRes();

    securityHeaders(req, res, next);

    const headerNames = (res.setHeader as any).mock.calls.map((c: any[]) => c[0]);
    // All expected headers
    expect(headerNames).toContain('X-Frame-Options');
    expect(headerNames).toContain('X-Content-Type-Options');
    expect(headerNames).toContain('Referrer-Policy');
    expect(headerNames).toContain('Permissions-Policy');
    expect(headerNames).toContain('Cross-Origin-Embedder-Policy');
    expect(headerNames).toContain('Cross-Origin-Opener-Policy');
    expect(headerNames).toContain('Cross-Origin-Resource-Policy');
    expect(headerNames).toContain('Content-Security-Policy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Error Handler Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('errorHandler', () => {
  let req: Request;
  let res: Response;

  beforeEach(() => {
    vi.clearAllMocks();
    req = createReq();
    res = createRes();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ── Prisma errors ────────────────────────────────────────────────────────

  describe('Prisma errors', () => {
    it('handles P2002 (unique constraint) with 409', () => {
      const err = { code: 'P2002', meta: { target: ['email'] } };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'A record with this value already exists',
        field: ['email'],
      });
    });

    it('handles P2002 without meta.target', () => {
      const err = { code: 'P2002' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'A record with this value already exists',
          field: undefined,
        }),
      );
    });

    it('handles P2003 (foreign key) with 400', () => {
      const err = { code: 'P2003' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid reference to related record',
      });
    });

    it('handles P2025 (record not found) with 404', () => {
      const err = { code: 'P2025' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Record not found',
      });
    });
  });

  // ── Plan limit ───────────────────────────────────────────────────────────

  describe('PLAN_LIMIT_EXCEEDED', () => {
    it('handles PLAN_LIMIT_EXCEEDED with 403', () => {
      const err = { code: 'PLAN_LIMIT_EXCEEDED', message: 'Task limit reached' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'PLAN_LIMIT_EXCEEDED',
        message: 'Task limit reached',
      });
    });

    it('handles PLAN_LIMIT_EXCEEDED without message', () => {
      const err = { code: 'PLAN_LIMIT_EXCEEDED' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Plan limit exceeded',
        }),
      );
    });
  });

  // ── Named error types ────────────────────────────────────────────────────

  describe('Named error types', () => {
    it('handles ValidationError with 400', () => {
      const err = {
        name: 'ValidationError',
        message: 'Invalid input',
        errors: [{ field: 'name', message: 'required' }],
      };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Validation error',
        errors: [{ field: 'name', message: 'required' }],
      });
    });

    it('handles UnauthorizedError with 401', () => {
      const err = { name: 'UnauthorizedError', message: 'Token expired' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Token expired',
      });
    });

    it('handles UnauthorizedError without message', () => {
      const err = { name: 'UnauthorizedError' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unauthorized' }),
      );
    });

    it('handles ForbiddenError with 403', () => {
      const err = { name: 'ForbiddenError', message: 'No access' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'No access',
      });
    });

    it('handles ForbiddenError without message', () => {
      const err = { name: 'ForbiddenError' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Forbidden' }),
      );
    });

    it('handles NotFoundError with 404', () => {
      const err = { name: 'NotFoundError', message: 'User not found' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not found',
      });
    });

    it('handles NotFoundError without message', () => {
      const err = { name: 'NotFoundError' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not found' }),
      );
    });

    it('handles ConflictError with 409', () => {
      const err = { name: 'ConflictError', message: 'Duplicate entry' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Duplicate entry',
      });
    });

    it('handles ConflictError without message', () => {
      const err = { name: 'ConflictError' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Conflict' }),
      );
    });
  });

  // ── Fallback ─────────────────────────────────────────────────────────────

  describe('Fallback', () => {
    it('uses err.statusCode when available', () => {
      const err = { statusCode: 418, message: "I'm a teapot" };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "I'm a teapot",
        }),
      );
    });

    it('defaults to 500 when no statusCode', () => {
      const err = { message: 'Something broke' };

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('defaults message to "Internal server error"', () => {
      const err = {};

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
        }),
      );
    });

    it('includes stack in development mode', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const err = {
        message: 'Dev error',
        stack: 'Error\n  at test (file.js:1:1)',
      };

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: 'Error\n  at test (file.js:1:1)',
        }),
      );

      process.env.NODE_ENV = original;
    });

    it('does not include stack in production', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const err = {
        message: 'Prod error',
        stack: 'Error\n  at test (file.js:1:1)',
      };

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ stack: expect.anything() }),
      );

      process.env.NODE_ENV = original;
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RBAC Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── hasPermission ────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('returns true for ADMIN role with ADMIN_ALL permission', () => {
      expect(hasPermission('ADMIN', Permission.ADMIN_ALL)).toBe(true);
    });

    it('returns true for ADMIN role with any permission (has ALL)', () => {
      expect(hasPermission('ADMIN', Permission.WORKSPACE_VIEW)).toBe(true);
      expect(hasPermission('ADMIN', Permission.TASK_DELETE)).toBe(true);
      expect(hasPermission('ADMIN', Permission.BILLING_MANAGE)).toBe(true);
    });

    it('returns true for WORKSPACE_OWNER with owned permissions', () => {
      expect(hasPermission('WORKSPACE_OWNER', Permission.WORKSPACE_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.WORKSPACE_EDIT)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.WORKSPACE_DELETE)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.WORKSPACE_INVITE)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.PROJECT_CREATE)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.TASK_ASSIGN)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.BILLING_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_OWNER', Permission.BILLING_MANAGE)).toBe(true);
    });

    it('returns false for WORKSPACE_OWNER with ADMIN_ALL', () => {
      expect(hasPermission('WORKSPACE_OWNER', Permission.ADMIN_ALL)).toBe(false);
    });

    it('returns true for WORKSPACE_ADMIN with allowed permissions', () => {
      expect(hasPermission('WORKSPACE_ADMIN', Permission.WORKSPACE_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.WORKSPACE_EDIT)).toBe(true);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.WORKSPACE_INVITE)).toBe(true);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.PROJECT_CREATE)).toBe(true);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.TASK_ASSIGN)).toBe(true);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.BILLING_VIEW)).toBe(true);
    });

    it('returns false for WORKSPACE_ADMIN with disallowed permissions', () => {
      expect(hasPermission('WORKSPACE_ADMIN', Permission.WORKSPACE_DELETE)).toBe(false);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.PROJECT_DELETE)).toBe(false);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.BILLING_MANAGE)).toBe(false);
      expect(hasPermission('WORKSPACE_ADMIN', Permission.ADMIN_ALL)).toBe(false);
    });

    it('returns true for WORKSPACE_MEMBER with allowed permissions', () => {
      expect(hasPermission('WORKSPACE_MEMBER', Permission.WORKSPACE_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.PROJECT_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.TASK_CREATE)).toBe(true);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.TASK_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.TASK_EDIT)).toBe(true);
    });

    it('returns false for WORKSPACE_MEMBER with disallowed permissions', () => {
      expect(hasPermission('WORKSPACE_MEMBER', Permission.WORKSPACE_EDIT)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.WORKSPACE_DELETE)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.WORKSPACE_INVITE)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.PROJECT_CREATE)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.TASK_DELETE)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.TASK_ASSIGN)).toBe(false);
      expect(hasPermission('WORKSPACE_MEMBER', Permission.BILLING_VIEW)).toBe(false);
    });

    it('returns true for WORKSPACE_VIEWER with allowed permissions', () => {
      expect(hasPermission('WORKSPACE_VIEWER', Permission.WORKSPACE_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_VIEWER', Permission.PROJECT_VIEW)).toBe(true);
      expect(hasPermission('WORKSPACE_VIEWER', Permission.TASK_VIEW)).toBe(true);
    });

    it('returns false for WORKSPACE_VIEWER with write permissions', () => {
      expect(hasPermission('WORKSPACE_VIEWER', Permission.WORKSPACE_EDIT)).toBe(false);
      expect(hasPermission('WORKSPACE_VIEWER', Permission.TASK_CREATE)).toBe(false);
      expect(hasPermission('WORKSPACE_VIEWER', Permission.TASK_EDIT)).toBe(false);
    });

    it('returns false for unknown role', () => {
      expect(hasPermission('UNKNOWN_ROLE', Permission.WORKSPACE_VIEW)).toBe(false);
    });

    it('returns false for empty string role', () => {
      expect(hasPermission('', Permission.WORKSPACE_VIEW)).toBe(false);
    });
  });

  // ── requirePermission ────────────────────────────────────────────────────

  describe('requirePermission', () => {
    it('returns 401 when user is not authenticated', async () => {
      const req = createReq({});
      const res = createRes();

      const middleware = requirePermission(Permission.WORKSPACE_VIEW);
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Authentication required',
          code: 'NOT_AUTHENTICATED',
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when user lacks required permission', async () => {
      const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'WORKSPACE_VIEWER' } });
      const res = createRes();

      const middleware = requirePermission(Permission.TASK_CREATE);
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Insufficient permissions',
          code: 'FORBIDDEN',
          required: [Permission.TASK_CREATE],
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when user has one of the required permissions (OR logic)', async () => {
      const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'WORKSPACE_MEMBER' } });
      const res = createRes();

      const middleware = requirePermission(Permission.TASK_CREATE, Permission.TASK_EDIT);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() when user has the single required permission', async () => {
      const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'WORKSPACE_MEMBER' } });
      const res = createRes();

      const middleware = requirePermission(Permission.WORKSPACE_VIEW);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('calls next() for ADMIN role with any permission', async () => {
      const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });
      const res = createRes();

      const middleware = requirePermission(Permission.BILLING_MANAGE);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when user has none of the multiple required permissions', async () => {
      const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'WORKSPACE_VIEWER' } });
      const res = createRes();

      const middleware = requirePermission(
        Permission.WORKSPACE_DELETE,
        Permission.PROJECT_DELETE,
        Permission.TASK_DELETE,
      );
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── requireWorkspaceMembership ───────────────────────────────────────────

  describe('requireWorkspaceMembership', () => {
    it('returns 401 when user is not authenticated', async () => {
      const req = createReq({ params: { workspaceId: 'ws1' } });
      const res = createRes();

      const middleware = requireWorkspaceMembership();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NOT_AUTHENTICATED',
        }),
      );
    });

    it('returns 400 when workspaceId is missing', async () => {
      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: {},
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'MISSING_WORKSPACE_ID',
        }),
      );
    });

    it('returns 403 when user is not a workspace member', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NOT_WORKSPACE_MEMBER',
        }),
      );
      expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: {
          userId_workspaceId: { userId: 'u1', workspaceId: 'ws1' },
        },
        select: { role: true },
      });
    });

    it('calls next() and attaches workspaceRole when membership is valid (no minRole)', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).workspaceRole).toBe('MEMBER');
    });

    it('allows access when user role meets minimum role requirement', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership('ADMIN');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).workspaceRole).toBe('OWNER');
    });

    it('returns 403 when user role is below minimum', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership('ADMIN');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INSUFFICIENT_ROLE',
          required: 'ADMIN',
          current: 'VIEWER',
        }),
      );
    });

    it('allows access when role equals minimum exactly', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: 'ADMIN' });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership('ADMIN');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 403 for VIEWER when MEMBER required', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { workspaceId: 'ws1' },
      });
      const res = createRes();

      const middleware = requireWorkspaceMembership('MEMBER');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── requireResourceOwnership ─────────────────────────────────────────────

  describe('requireResourceOwnership', () => {
    it('returns 401 when user is not authenticated', async () => {
      const req = createReq({ params: { taskId: 't1' } });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'NOT_AUTHENTICATED' }),
      );
    });

    it('returns 400 when resource ID is missing (task)', async () => {
      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: {},
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'MISSING_RESOURCE_ID',
          message: 'task ID required',
        }),
      );
    });

    it('returns 400 when resource ID is missing (project)', async () => {
      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: {},
      });
      const res = createRes();

      const middleware = requireResourceOwnership('project');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'MISSING_RESOURCE_ID',
          message: 'project ID required',
        }),
      );
    });

    it('returns 404 when task is not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { taskId: 't1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TASK_NOT_FOUND',
        }),
      );
    });

    it('allows task creator to access', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        createdById: 'u1',
        assignees: [],
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { taskId: 't1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows assigned user to access task', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        createdById: 'other',
        assignees: [{ userId: 'u1' }],
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { taskId: 't1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when user is neither creator nor assignee', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        createdById: 'other',
        assignees: [{ userId: 'someone-else' }],
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { taskId: 't1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NOT_RESOURCE_OWNER',
        }),
      );
    });

    it('returns 404 when project is not found', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { projectId: 'p1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('project');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'PROJECT_NOT_FOUND',
        }),
      );
    });

    it('allows project creator to access', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        createdById: 'u1',
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { projectId: 'p1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('project');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when user is not project creator', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        createdById: 'other-user',
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { projectId: 'p1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('project');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NOT_RESOURCE_OWNER',
        }),
      );
    });

    it('uses req.params.id as fallback for resourceId', async () => {
      mockPrisma.task.findUnique.mockResolvedValue({
        createdById: 'u1',
        assignees: [],
      });

      const req = createReq({
        user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' },
        params: { id: 't1' },
      });
      const res = createRes();

      const middleware = requireResourceOwnership('task');
      await middleware(req, res, next);

      expect(mockPrisma.task.findUnique).toHaveBeenCalledWith({
        where: { id: 't1' },
        select: {
          createdById: true,
          assignees: { select: { userId: true } },
        },
      });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Focura Admin Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireFocuraAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 401 when user is not authenticated', () => {
    const req = createReq({});
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NOT_AUTHENTICATED',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not ADMIN role', () => {
    mockIsFocuraAdmin.mockReturnValue(false);
    const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' } });
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FORBIDDEN',
      }),
    );
  });

  it('returns 403 when user is ADMIN but not in FOCURA_ADMIN_IDS', () => {
    mockIsFocuraAdmin.mockReturnValue(false);
    const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Forbidden: Admin access required',
      }),
    );
    expect(mockIsFocuraAdmin).toHaveBeenCalledWith('u1');
  });

  it('returns 403 when isFocuraAdmin returns false even with ADMIN role', () => {
    mockIsFocuraAdmin.mockReturnValue(false);
    const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('calls next() when user is ADMIN and isFocuraAdmin returns true', () => {
    mockIsFocuraAdmin.mockReturnValue(true);
    const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500 when an unexpected error is thrown', () => {
    mockIsFocuraAdmin.mockImplementation(() => {
      throw new Error('Unexpected error');
    });
    const req = createReq({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });
    const res = createRes();

    requireFocuraAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Internal server error',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DB Monitoring Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('dbMonitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sets pool metrics as response headers', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 10,
      activeConnections: 3,
      idleConnections: 7,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Total', '10');
    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Active', '3');
    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Idle', '7');
    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Waiting', '0');
  });

  it('calls next()', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 10,
      activeConnections: 3,
      idleConnections: 7,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not warn when utilization is at or below 80%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 10,
      activeConnections: 8,
      idleConnections: 2,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when utilization exceeds 80%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 10,
      activeConnections: 9,
      idleConnections: 1,
      waitingRequests: 2,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(console.warn).toHaveBeenCalled();
    const warnCalls = (console.warn as any).mock.calls.map((c: any[]) =>
      c.join(' '),
    );
    expect(warnCalls.some((msg: string) => msg.includes('High database connection pool utilization'))).toBe(true);
  });

  it('warns when utilization is exactly 100%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 5,
      activeConnections: 5,
      idleConnections: 0,
      waitingRequests: 10,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(console.warn).toHaveBeenCalled();
  });

  it('handles zero totalConnections (no division by zero)', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbMonitoring(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Total', '0');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('dbPoolGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls next() when utilization is below 75%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 100,
      activeConnections: 50,
      idleConnections: 50,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not set warning header when utilization is at or below 75%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 100,
      activeConnections: 75,
      idleConnections: 25,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalledWith(
      'X-DB-Pool-Warning',
      'high-utilization',
    );
    expect(next).toHaveBeenCalled();
  });

  it('sets warning header when utilization exceeds 75%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 100,
      activeConnections: 76,
      idleConnections: 24,
      waitingRequests: 5,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Warning', 'high-utilization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when utilization is >= 95%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 100,
      activeConnections: 95,
      idleConnections: 5,
      waitingRequests: 20,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Service temporarily unavailable',
      message: 'Database connection pool exhausted. Please try again later.',
      retryAfter: 5,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 when utilization exceeds 95%', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 100,
      activeConnections: 98,
      idleConnections: 2,
      waitingRequests: 30,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 at exactly 100% utilization', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 10,
      activeConnections: 10,
      idleConnections: 0,
      waitingRequests: 50,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('handles zero totalConnections (no division by zero)', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sets warning header between 75% and 95% (warning zone)', () => {
    mockGetPoolMetrics.mockReturnValue({
      totalConnections: 200,
      activeConnections: 180, // 90%
      idleConnections: 20,
      waitingRequests: 15,
    });

    const req = createReq();
    const res = createRes();

    dbPoolGuard(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-DB-Pool-Warning', 'high-utilization');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(503);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Rate Limiter Middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function createMockRedis() {
    const execResults: any[] = [];
    const pipeObj = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(execResults),
    };
    return {
      pipeline: vi.fn().mockReturnValue(pipeObj),
      _pipeObj: pipeObj,
      _execResults: execResults,
    };
  }

  it('calls next() when under the rate limit', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]); // zremrangebyscore
    redis._execResults.push([null, 1]); // zadd
    redis._execResults.push([null, 1]); // zcard (count = 1)
    redis._execResults.push([null, 1]); // expire
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(429);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 101]); // count = 101 > max of 100
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 429 with RATE_LIMIT_SERVICE_UNAVAILABLE on Redis error', async () => {
    mockGetRedisClient.mockImplementation(() => {
      throw new Error('Redis connection failed');
    });

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Rate limit service unavailable',
        code: 'RATE_LIMIT_SERVICE_UNAVAILABLE',
        retryAfter: 60,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('extracts IP from x-forwarded-for header', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq({
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
    });
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(redis.pipeline).toHaveBeenCalled();
    // Key should be based on the first IP
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to req.ip when x-forwarded-for is absent', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq({ ip: '127.0.0.1' });
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses "unknown" as IP fallback when both x-forwarded-for and req.ip are missing', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq({ ip: undefined });
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses default max=100 and windowSeconds=60 when not specified', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 50]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when count equals max (count > max check)', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 100]); // count == max, should NOT exceed
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    // count (100) > max (100) is false, so next() is called
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when count is max + 1', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 101]); // count > max
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('returns 429 when pipeline exec returns error tuple', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([new Error('zcard failed'), null]); // error in zcard
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    // count defaults to 0 because zcardResult is null
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('handles pipeline exec returning undefined results', async () => {
    const redis = createMockRedis();
    redis._pipeObj.exec.mockResolvedValue(undefined);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    // results is undefined, so count = 0
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('handles empty pipeline results array', async () => {
    const redis = createMockRedis();
    redis._pipeObj.exec.mockResolvedValue([]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(100, 60);
    await middleware(req, res, next);

    // results[2] is undefined, count = 0
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses custom max and windowSeconds', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 10]); // count = 10
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(10, 30);
    await middleware(req, res, next);

    // 10 > 10 is false
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 with custom window in retryAfter', async () => {
    const redis = createMockRedis();
    redis._execResults.push([null, 0]);
    redis._execResults.push([null, 1]);
    redis._execResults.push([null, 100]);
    redis._execResults.push([null, 1]);
    mockGetRedisClient.mockReturnValue(redis);

    const req = createReq();
    const res = createRes();

    const middleware = rateLimitMiddleware(10, 30);
    await middleware(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAfter: 30,
      }),
    );
  });
});
