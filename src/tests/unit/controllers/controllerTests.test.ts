import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';

// ══════════════════════════════════════════════════════════════════════════════
// vi.hoisted — must come first so vi.mock can reference them
// ══════════════════════════════════════════════════════════════════════════════

const {
  mockPrismaUserFindUnique,
  mockPrismaUserUpdate,
  mockPrismaWorkspaceFindMany,
  mockPrismaProjectFindMany,
  mockPrismaPopularResourceFindMany,
  mockPrismaProductUpdateFindMany,
  mockRedisGet,
  mockRedisSetex,
  mockRedisDel,
  mockRedisExists,
  mockPipelineExec,
  mockCacheClientGet,
  mockCacheClientSet,
  mockUserCacheInvalidateProfile,
  mockArgon2Verify,
  mockArgon2Hash,
  mockAddSendNotificationJob,
  mockLimitApiRequest,
} = vi.hoisted(() => ({
  mockPrismaUserFindUnique: vi.fn(),
  mockPrismaUserUpdate: vi.fn(),
  mockPrismaWorkspaceFindMany: vi.fn(),
  mockPrismaProjectFindMany: vi.fn(),
  mockPrismaPopularResourceFindMany: vi.fn(),
  mockPrismaProductUpdateFindMany: vi.fn(),
  mockRedisGet: vi.fn(async () => null),
  mockRedisSetex: vi.fn(async () => 'OK'),
  mockRedisDel: vi.fn(async () => 1),
  mockRedisExists: vi.fn(async () => 1),
  mockPipelineExec: vi.fn(async () => []),
  mockCacheClientGet: vi.fn(async () => null),
  mockCacheClientSet: vi.fn(async () => 'OK'),
  mockUserCacheInvalidateProfile: vi.fn(async () => undefined),
  mockArgon2Verify: vi.fn(async () => true),
  mockArgon2Hash: vi.fn(async () => '$argon2id$v=19$m=65536,t=3,p=4$hashed'),
  mockAddSendNotificationJob: vi.fn(async () => ({})),
  mockLimitApiRequest: vi.fn(async () => ({
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 60000,
  })),
}));

// ─── Mock: prisma ────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    get user() {
      return {
        findUnique: mockPrismaUserFindUnique,
        update: mockPrismaUserUpdate,
      };
    },
    get workspace() {
      return { findMany: mockPrismaWorkspaceFindMany };
    },
    get project() {
      return { findMany: mockPrismaProjectFindMany };
    },
    get popularResource() {
      return { findMany: mockPrismaPopularResourceFindMany };
    },
    get productUpdate() {
      return { findMany: mockPrismaProductUpdateFindMany };
    },
  },
}));

// ─── Mock: Redis ─────────────────────────────────────────────────────────────

vi.mock('../../../redis/redis.client.js', () => ({
  getRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
    del: mockRedisDel,
    exists: mockRedisExists,
    pipeline: vi.fn(() => ({
      get: vi.fn(),
      setex: vi.fn(),
      exec: mockPipelineExec,
    })),
  })),
}));

// ─── Mock: Cache Client ──────────────────────────────────────────────────────

vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: {
    get: (...args: any[]) => mockCacheClientGet(...args),
    set: (...args: any[]) => mockCacheClientSet(...args),
  },
  UserCache: {
    invalidateProfile: (...args: any[]) => mockUserCacheInvalidateProfile(...args),
  },
  CACHE_KEYS: {
    authResult: (jti: string) => `auth:result:${jti}`,
    userProfile: (id: string) => `user:profile:${id}`,
  },
  CACHE_TTL: {
    USER_PROFILE: 1800,
    AUTH_RESULT: 300,
  },
}));

// ─── Mock: argon2 ────────────────────────────────────────────────────────────

vi.mock('argon2', () => ({
  default: {
    verify: (...args: any[]) => mockArgon2Verify(...args),
    hash: (...args: any[]) => mockArgon2Hash(...args),
  },
}));

// ─── Mock: slugify ───────────────────────────────────────────────────────────

vi.mock('slugify', () => ({
  default: {
    default: (name: string, _opts?: any) => {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    },
  },
}));

// ─── Mock: notification queue ────────────────────────────────────────────────

vi.mock('../../../queue/queues/notification.queue.js', () => ({
  addSendNotificationJob: (...args: any[]) => mockAddSendNotificationJob(...args),
}));

// ─── Mock: limiter ───────────────────────────────────────────────────────────

vi.mock('../../../lib/limiter.js', () => ({
  limitApiRequest: (...args: any[]) => mockLimitApiRequest(...args),
}));

// ─── Mock: sessionBinding ────────────────────────────────────────────────────

vi.mock('../../../lib/auth/sessionBinding.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  validateSessionBinding: vi.fn(() => ({ valid: true })),
  createSessionMetadata: vi.fn(() => ({
    deviceId: 'test-device',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    lastActivity: Date.now(),
  })),
}));

// ─── Mock: tokenRevocation ──────────────────────────────────────────────────

vi.mock('../../../lib/auth/tokenRevocation.js', () => ({
  isAccessTokenRevoked: vi.fn(async () => false),
  revokeAllRefreshTokens: vi.fn(async () => {}),
}));

// ─── Mock: auditLog ──────────────────────────────────────────────────────────

vi.mock('../../../lib/auth/auditLog.js', () => ({
  auditLog: vi.fn(),
}));

// ─── Mock: sentry ────────────────────────────────────────────────────────────

vi.mock('../../../lib/sentry.js', () => ({
  setUserContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// ─── Mock: AppError ──────────────────────────────────────────────────────────

vi.mock('../../../errors/AppError.js', () => ({
  UnauthorizedError: class extends Error {
    code: string;
    constructor(msg: string, code: string = 'UNAUTHORIZED') {
      super(msg);
      this.code = code;
    }
  },
  ForbiddenError: class extends Error {
    constructor(msg: string) { super(msg); }
  },
  TokenExpiredError: class extends Error {
    constructor() { super('Token expired'); }
  },
  InvalidTokenError: class extends Error {
    constructor(msg?: string) { super(msg || 'Invalid token'); }
  },
  TokenRevokedError: class extends Error {
    constructor() { super('Token revoked'); }
  },
  SessionHijackError: class extends Error {
    constructor(msg?: string) { super(msg || 'Session hijack'); }
  },
  EmailNotVerifiedError: class extends Error {
    constructor() { super('Email not verified'); }
  },
  AccountBannedError: class extends Error {
    banReason: string | null;
    bannedAt: Date;
    constructor(reason: string | null, at: Date) {
      super('Account banned');
      this.banReason = reason;
      this.bannedAt = at;
    }
  },
}));

// ══════════════════════════════════════════════════════════════════════════════
// Import after all mocks
// ══════════════════════════════════════════════════════════════════════════════

import { getUserProfile, updateUserProfile, changePassword } from '../../../controllers/user.controller.js';
import { SlugService } from '../../../services/slug.service.js';
import { prisma } from '../../../lib/prisma.js';
import { UserCache } from '../../../lib/redis/cache.client.js';
import argon2 from 'argon2';
import {
  batchWasAlreadySent,
  batchMarkAsSent,
  processPendingNotifications,
} from '../../../modules/notification/cron.utils.js';
import {
  sessionTimeout,
  recordSessionCreation,
  invalidateSession,
} from '../../../middleware/sessionTimeout.js';
import { authorize, rateLimitByUser } from '../../../middleware/auth.js';
import { getRedisClient } from '../../../redis/redis.client.js';

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function createReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 'user-1', email: 'test@test.com', role: 'user', name: 'Test' },
    body: {},
    params: {},
    headers: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function createRes() {
  const res: any = {
    _status: 200,
    _body: null as any,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
    },
    getHeader(name: string) {
      return res._headers[name];
    },
  };
  return res;
}

const next = vi.fn();

// ══════════════════════════════════════════════════════════════════════════════
// USER CONTROLLER
// ══════════════════════════════════════════════════════════════════════════════

describe('User Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getUserProfile ────────────────────────────────────────────────────────

  describe('getUserProfile', () => {
    it('returns 401 when no user.id', async () => {
      const req = createReq({ user: undefined });
      const res = createRes();

      await getUserProfile(req, res);

      expect(res._status).toBe(401);
      expect(res._body.success).toBe(false);
      expect(res._body.message).toBe('Unauthorized');
    });

    it('returns 401 when user.id is empty string', async () => {
      const req = createReq({ user: { id: '', email: '', role: 'user' } });
      const res = createRes();

      await getUserProfile(req, res);

      expect(res._status).toBe(401);
    });

    it('returns 404 when user not found', async () => {
      mockPrismaUserFindUnique.mockResolvedValueOnce(null);
      const req = createReq();
      const res = createRes();

      await getUserProfile(req, res);

      expect(res._status).toBe(404);
      expect(res._body.message).toBe('User not found');
    });

    it('returns 200 with user data', async () => {
      const mockUser = {
        id: 'user-1',
        name: 'Test User',
        email: 'test@test.com',
        image: 'https://example.com/img.png',
        bio: 'Hello',
        timezone: 'UTC',
        role: 'user',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
        ownedWorkspaces: [{ id: 'ws-1', name: 'WS', plan: 'free', maxStorage: 5, slug: 'ws' }],
      };
      mockPrismaUserFindUnique.mockResolvedValueOnce(mockUser);
      const req = createReq();
      const res = createRes();

      await getUserProfile(req, res);

      expect(res._status).toBe(200);
      expect(res._body.success).toBe(true);
      expect(res._body.data.user).toEqual(mockUser);
      expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({ id: true, name: true, email: true }),
      });
    });

    it('returns 500 on unexpected error', async () => {
      mockPrismaUserFindUnique.mockRejectedValueOnce(new Error('DB down'));
      const req = createReq();
      const res = createRes();

      await getUserProfile(req, res);

      expect(res._status).toBe(500);
      expect(res._body.message).toBe('Failed to fetch profile');
    });
  });

  // ── updateUserProfile ─────────────────────────────────────────────────────

  describe('updateUserProfile', () => {
    it('returns 401 when no user.id', async () => {
      const req = createReq({ user: undefined });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(401);
      expect(res._body.message).toBe('Unauthorized');
    });

    it('returns 400 when name is not a string', async () => {
      const req = createReq({ body: { name: 123 } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid name format');
    });

    it('returns 400 when name exceeds 100 chars', async () => {
      const req = createReq({ body: { name: 'x'.repeat(101) } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Name too long (max 100 characters)');
    });

    it('returns 400 when bio is not a string', async () => {
      const req = createReq({ body: { bio: 42 } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid bio format');
    });

    it('returns 400 when bio exceeds 500 chars', async () => {
      const req = createReq({ body: { bio: 'x'.repeat(501) } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Bio too long (max 500 characters)');
    });

    it('returns 400 when timezone is not a string', async () => {
      const req = createReq({ body: { timezone: 123 } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid timezone format');
    });

    it('returns 400 when image is not a string or null', async () => {
      const req = createReq({ body: { image: 123 } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid image format');
    });

    it('returns 400 when image URL protocol is invalid', async () => {
      const req = createReq({ body: { image: 'ftp://example.com/img.png' } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Image URL must use http or https protocol');
    });

    it('returns 400 when image URL exceeds 2048 chars', async () => {
      const req = createReq({ body: { image: 'https://example.com/' + 'x'.repeat(2049) } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Image URL too long (max 2048 characters)');
    });

    it('returns 400 when image URL is malformed', async () => {
      const req = createReq({ body: { image: 'not-a-url' } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid image URL format');
    });

    it('allows image=null without validation error', async () => {
      const updatedUser = { id: 'user-1', name: 'Test', email: 'test@test.com', image: null, bio: null, timezone: 'UTC', role: 'user', createdAt: new Date(), updatedAt: new Date() };
      mockPrismaUserUpdate.mockResolvedValueOnce(updatedUser);
      mockUserCacheInvalidateProfile.mockResolvedValueOnce(undefined);
      const req = createReq({ body: { image: null } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(200);
      expect(mockPrismaUserUpdate).toHaveBeenCalled();
    });

    it('returns 200 with updated user and invalidates cache', async () => {
      const updatedUser = { id: 'user-1', name: 'New', email: 'test@test.com', image: null, bio: 'Updated', timezone: 'US/Eastern', role: 'user', createdAt: new Date(), updatedAt: new Date() };
      mockPrismaUserUpdate.mockResolvedValueOnce(updatedUser);
      mockUserCacheInvalidateProfile.mockResolvedValueOnce(undefined);
      const req = createReq({ body: { name: 'New', bio: 'Updated', timezone: 'US/Eastern' } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(200);
      expect(res._body.success).toBe(true);
      expect(res._body.message).toBe('Profile updated successfully');
      expect(res._body.data.user).toEqual(updatedUser);
      expect(mockUserCacheInvalidateProfile).toHaveBeenCalledWith('user-1');
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New', bio: 'Updated', timezone: 'US/Eastern' },
        select: expect.objectContaining({ id: true }),
      });
    });

    it('returns 500 on unexpected error', async () => {
      mockPrismaUserUpdate.mockRejectedValueOnce(new Error('DB fail'));
      const req = createReq({ body: { name: 'X' } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(res._status).toBe(500);
      expect(res._body.message).toBe('Failed to update profile');
    });

    it('sends only provided fields in updateData', async () => {
      mockPrismaUserUpdate.mockResolvedValueOnce({
        id: 'user-1', name: 'A', email: 'e', image: null, bio: null, timezone: null, role: 'u', createdAt: new Date(), updatedAt: new Date(),
      });
      const req = createReq({ body: { name: 'A' } });
      const res = createRes();

      await updateUserProfile(req, res);

      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'A' },
        select: expect.any(Object),
      });
    });
  });

  // ── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('returns 401 when no user.id', async () => {
      const req = createReq({ user: undefined });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(401);
      expect(res._body.message).toBe('Unauthorized');
    });

    it('returns 400 when currentPassword or newPassword missing', async () => {
      const req = createReq({ body: { currentPassword: 'old' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Current password and new password are required');
    });

    it('returns 400 when passwords are not strings', async () => {
      const req = createReq({ body: { currentPassword: 123, newPassword: 456 } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('Invalid password format');
    });

    it('returns 400 when newPassword < 8 chars', async () => {
      const req = createReq({ body: { currentPassword: 'oldpassword', newPassword: 'short' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('New password must be at least 8 characters');
    });

    it('returns 400 when newPassword > 128 chars', async () => {
      const req = createReq({ body: { currentPassword: 'oldpassword', newPassword: 'x'.repeat(129) } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('New password must be less than 128 characters');
    });

    it('returns 400 when newPassword equals currentPassword', async () => {
      const req = createReq({ body: { currentPassword: 'samepass123', newPassword: 'samepass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toBe('New password must be different from current password');
    });

    it('returns 404 when user not found', async () => {
      mockPrismaUserFindUnique.mockResolvedValueOnce(null);
      const req = createReq({ body: { currentPassword: 'oldpass123', newPassword: 'newpass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(404);
      expect(res._body.message).toBe('User not found');
    });

    it('returns 400 for OAuth-only accounts (no password)', async () => {
      mockPrismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1', password: null });
      const req = createReq({ body: { currentPassword: 'oldpass123', newPassword: 'newpass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(400);
      expect(res._body.message).toContain('social login');
    });

    it('returns 401 when current password is incorrect', async () => {
      mockPrismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1', password: '$argon2hashed' });
      mockArgon2Verify.mockResolvedValueOnce(false);
      const req = createReq({ body: { currentPassword: 'wrongpass', newPassword: 'newpass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(401);
      expect(res._body.message).toBe('Current password is incorrect');
    });

    it('returns 200 and updates password on success', async () => {
      mockPrismaUserFindUnique.mockResolvedValueOnce({ id: 'user-1', password: '$argon2hashed' });
      mockArgon2Verify.mockResolvedValueOnce(true);
      mockArgon2Hash.mockResolvedValueOnce('$argon2id$v=19$newhash');
      mockPrismaUserUpdate.mockResolvedValueOnce({});
      mockUserCacheInvalidateProfile.mockResolvedValueOnce(undefined);
      const req = createReq({ body: { currentPassword: 'oldpass123', newPassword: 'newpass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(200);
      expect(res._body.success).toBe(true);
      expect(res._body.message).toBe('Password changed successfully');
      expect(mockArgon2Verify).toHaveBeenCalledWith('$argon2hashed', 'oldpass123');
      expect(mockArgon2Hash).toHaveBeenCalledWith('newpass123');
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: '$argon2id$v=19$newhash' },
      });
      expect(mockUserCacheInvalidateProfile).toHaveBeenCalledWith('user-1');
    });

    it('returns 500 on unexpected error', async () => {
      mockPrismaUserFindUnique.mockRejectedValueOnce(new Error('DB fail'));
      const req = createReq({ body: { currentPassword: 'oldpass123', newPassword: 'newpass123' } });
      const res = createRes();

      await changePassword(req, res);

      expect(res._status).toBe(500);
      expect(res._body.message).toBe('Failed to change password');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SLUG SERVICE
// ══════════════════════════════════════════════════════════════════════════════

describe('SlugService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateWorkspaceSlug', () => {
    it('returns base slug when no collisions', async () => {
      mockPrismaWorkspaceFindMany.mockResolvedValueOnce([]);
      const slug = await SlugService.generateWorkspaceSlug('My Workspace');
      expect(slug).toBe('my-workspace');
      expect(mockPrismaWorkspaceFindMany).toHaveBeenCalledWith({
        where: { slug: { startsWith: 'my-workspace' } },
        select: { slug: true },
      });
    });

    it('appends -N when collisions exist (1 match → -2)', async () => {
      mockPrismaWorkspaceFindMany.mockResolvedValueOnce([{ slug: 'my-workspace' }]);
      const slug = await SlugService.generateWorkspaceSlug('My Workspace');
      expect(slug).toBe('my-workspace-2');
    });

    it('appends correct suffix for multiple matches (2 matches → -3)', async () => {
      mockPrismaWorkspaceFindMany.mockResolvedValueOnce([
        { slug: 'my-workspace' },
        { slug: 'my-workspace-2' },
      ]);
      const slug = await SlugService.generateWorkspaceSlug('My Workspace');
      expect(slug).toBe('my-workspace-3');
    });

    it('handles special characters via slugify strict mode', async () => {
      mockPrismaWorkspaceFindMany.mockResolvedValueOnce([]);
      const slug = await SlugService.generateWorkspaceSlug('Hello & World! @2024');
      expect(slug).toBe('hello-world-2024');
    });
  });

  describe('generateProjectSlug', () => {
    it('returns base slug when no collisions', async () => {
      mockPrismaProjectFindMany.mockResolvedValueOnce([]);
      const slug = await SlugService.generateProjectSlug('New Project', 'ws-1');
      expect(slug).toBe('new-project');
      expect(mockPrismaProjectFindMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', slug: { startsWith: 'new-project' } },
        select: { slug: true },
      });
    });

    it('appends -N when collisions exist', async () => {
      mockPrismaProjectFindMany.mockResolvedValueOnce([
        { slug: 'new-project' },
        { slug: 'new-project-2' },
      ]);
      const slug = await SlugService.generateProjectSlug('New Project', 'ws-1');
      expect(slug).toBe('new-project-3');
    });
  });

  describe('generatePopularResourceSlug', () => {
    it('returns base slug when no collisions', async () => {
      mockPrismaPopularResourceFindMany.mockResolvedValueOnce([]);
      const slug = await SlugService.generatePopularResourceSlug('Getting Started');
      expect(slug).toBe('getting-started');
      expect(mockPrismaPopularResourceFindMany).toHaveBeenCalledWith({
        where: { slug: { startsWith: 'getting-started' } },
        select: { slug: true },
      });
    });

    it('appends -N when collisions exist', async () => {
      mockPrismaPopularResourceFindMany.mockResolvedValueOnce([{ slug: 'getting-started' }]);
      const slug = await SlugService.generatePopularResourceSlug('Getting Started');
      expect(slug).toBe('getting-started-2');
    });
  });

  describe('generateProductUpdateSlug', () => {
    it('returns base slug when no collisions', async () => {
      mockPrismaProductUpdateFindMany.mockResolvedValueOnce([]);
      const slug = await SlugService.generateProductUpdateSlug('v2.0 Release');
      expect(slug).toBe('v2-0-release');
      expect(mockPrismaProductUpdateFindMany).toHaveBeenCalledWith({
        where: { slug: { startsWith: 'v2-0-release' } },
        select: { slug: true },
      });
    });

    it('appends -N when collisions exist', async () => {
      mockPrismaProductUpdateFindMany.mockResolvedValueOnce([
        { slug: 'v2-0-release' },
        { slug: 'v2-0-release-2' },
        { slug: 'v2-0-release-3' },
      ]);
      const slug = await SlugService.generateProductUpdateSlug('v2.0 Release');
      expect(slug).toBe('v2-0-release-4');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRON UTILS (Notification)
// ══════════════════════════════════════════════════════════════════════════════

describe('Cron Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('batchWasAlreadySent', () => {
    it('returns empty Set when keys array is empty', async () => {
      const result = await batchWasAlreadySent([]);
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('returns Set of keys that have values in pipeline results', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [null, '1'],
        [null, null],
        [null, '1'],
      ]);

      const result = await batchWasAlreadySent(['key-0', 'key-1', 'key-2']);

      expect(result.size).toBe(2);
      expect(result.has('key-0')).toBe(true);
      expect(result.has('key-2')).toBe(true);
      expect(result.has('key-1')).toBe(false);
    });

    it('skips entries with errors in pipeline results', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [new Error('redis error'), null],
        [null, '1'],
      ]);

      const result = await batchWasAlreadySent(['bad-key', 'good-key']);

      expect(result.size).toBe(1);
      expect(result.has('good-key')).toBe(true);
    });

    it('returns empty Set when pipeline returns null', async () => {
      mockPipelineExec.mockResolvedValueOnce(null);

      const result = await batchWasAlreadySent(['key-1']);

      expect(result.size).toBe(0);
    });
  });

  describe('batchMarkAsSent', () => {
    it('does nothing when keys array is empty', async () => {
      await batchMarkAsSent([]);
      expect(mockPipelineExec).not.toHaveBeenCalled();
    });

    it('calls pipeline exec with setex calls via the pipeline', async () => {
      // The pipeline returned by redis.pipeline() has its own setex mock
      // We just verify the pipeline.exec was called (the setex calls happen on the inner mock)
      await batchMarkAsSent(['key-a', 'key-b']);

      expect(mockPipelineExec).toHaveBeenCalled();
    });
  });

  describe('processPendingNotifications', () => {
    it('returns 0 when pending array is empty', async () => {
      const count = await processPendingNotifications([]);
      expect(count).toBe(0);
    });

    it('returns 0 when all notifications already sent (dedup)', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [null, '1'],
        [null, '1'],
      ]);

      const pending = [
        { dedupKey: 'dk1', userId: 'u1', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
        { dedupKey: 'dk2', userId: 'u2', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
      ];

      const count = await processPendingNotifications(pending);

      expect(count).toBe(0);
      expect(mockAddSendNotificationJob).not.toHaveBeenCalled();
    });

    it('dispatches non-deduped notifications and marks them sent', async () => {
      // First call: batchWasAlreadySent
      mockPipelineExec.mockResolvedValueOnce([
        [null, '1'],
        [null, null],
      ]);

      mockAddSendNotificationJob.mockResolvedValueOnce({});

      // Second call: batchMarkAsSent
      mockPipelineExec.mockResolvedValueOnce([]);

      const pending = [
        { dedupKey: 'dk1', userId: 'u1', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
        { dedupKey: 'dk2', userId: 'u2', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
      ];

      const count = await processPendingNotifications(pending);

      expect(count).toBe(1);
      expect(mockAddSendNotificationJob).toHaveBeenCalledTimes(1);
      expect(mockAddSendNotificationJob).toHaveBeenCalledWith({
        userId: 'u2',
        type: 't',
        title: 'T',
        message: 'M',
        actionUrl: '/a',
      });
    });

    it('handles mixed success and failure in BullMQ dispatch', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [null, null],
        [null, null],
      ]);

      mockAddSendNotificationJob
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('queue full'));

      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const pending = [
        { dedupKey: 'dk1', userId: 'u1', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
        { dedupKey: 'dk2', userId: 'u2', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
      ];

      const count = await processPendingNotifications(pending);

      expect(count).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('marks all as sent when all BullMQ calls succeed', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [null, null],
        [null, null],
      ]);

      mockAddSendNotificationJob.mockResolvedValue({});

      // batchMarkAsSent
      mockPipelineExec.mockResolvedValueOnce([]);

      const pending = [
        { dedupKey: 'dk1', userId: 'u1', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
        { dedupKey: 'dk2', userId: 'u2', type: 't', title: 'T', message: 'M', actionUrl: '/a' },
      ];

      const count = await processPendingNotifications(pending);

      expect(count).toBe(2);
      // batchMarkAsSent was called, which calls pipeline.exec
      expect(mockPipelineExec).toHaveBeenCalledTimes(2);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SESSION TIMEOUT MIDDLEWARE
// ══════════════════════════════════════════════════════════════════════════════

describe('Session Timeout Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sessionTimeout', () => {
    it('calls next() when no sessionId (no user.tokenJti)', async () => {
      const req = createReq({ user: { id: 'u1', email: 'e', role: 'r', tokenJti: undefined } }) as any;
      const res = createRes() as any;

      await sessionTimeout(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when absolute timeout expired', async () => {
      mockRedisExists.mockResolvedValueOnce(0);
      const req = createReq({ user: { id: 'u1', email: 'e', role: 'r', tokenJti: 'jti-1' } }) as any;
      const res = createRes() as any;

      await sessionTimeout(req, res, next);

      expect(res._status).toBe(401);
      expect(res._body.code).toBe('SESSION_TIMEOUT');
      expect(res._body.message).toContain('expired');
    });

    it('returns 401 when session is inactive', async () => {
      mockRedisExists
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      const req = createReq({ user: { id: 'u1', email: 'e', role: 'r', tokenJti: 'jti-1' } }) as any;
      const res = createRes() as any;

      await sessionTimeout(req, res, next);

      expect(res._status).toBe(401);
      expect(res._body.message).toContain('inactivity');
    });

    it('updates activity and calls next() when session is valid', async () => {
      mockRedisExists
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      mockRedisSetex.mockResolvedValueOnce('OK');

      const req = createReq({ user: { id: 'u1', email: 'e', role: 'r', tokenJti: 'jti-1' } }) as any;
      const res = createRes() as any;

      await sessionTimeout(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockRedisSetex).toHaveBeenCalled();
    });

    it('returns 500 when an unhandled exception propagates to the outer catch', async () => {
      // The 500 path fires when the outer try block throws outside internal try/catches.
      // We simulate this by making the req.user getter throw when tokenJti is accessed.
      const req = new Proxy(createReq({ user: { id: 'u1', email: 'e', role: 'r', tokenJti: 'jti-1' } }) as any, {
        get(target, prop) {
          if (prop === 'user') {
            throw new Error('unexpected user access error');
          }
          return Reflect.get(target, prop);
        },
      });
      const res = createRes() as any;

      await sessionTimeout(req, res, next);

      expect(res._status).toBe(500);
      expect(res._body.code).toBe('SESSION_ERROR');
    });
  });

  describe('recordSessionCreation', () => {
    it('stores both created and activity keys in Redis', async () => {
      await recordSessionCreation('session-123');

      expect(mockRedisSetex).toHaveBeenCalledTimes(2);
      expect(mockRedisSetex).toHaveBeenCalledWith(
        'session:created:session-123',
        expect.any(Number),
        expect.any(String),
      );
      expect(mockRedisSetex).toHaveBeenCalledWith(
        'session:activity:session-123',
        expect.any(Number),
        expect.any(String),
      );
    });

    it('throws on Redis error', async () => {
      mockRedisSetex.mockRejectedValueOnce(new Error('redis down'));

      await expect(recordSessionCreation('session-123')).rejects.toThrow('redis down');
    });
  });

  describe('invalidateSession', () => {
    it('deletes both created and activity keys', async () => {
      await invalidateSession('session-456');

      expect(mockRedisDel).toHaveBeenCalledTimes(2);
      expect(mockRedisDel).toHaveBeenCalledWith('session:created:session-456');
      expect(mockRedisDel).toHaveBeenCalledWith('session:activity:session-456');
    });

    it('does not throw on Redis error (silently catches)', async () => {
      mockRedisDel.mockRejectedValueOnce(new Error('redis down'));

      await expect(invalidateSession('session-456')).resolves.not.toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE — authorize
// ══════════════════════════════════════════════════════════════════════════════

describe('Auth Middleware — authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() when user has allowed role', () => {
    const req = createReq({ user: { id: 'u1', email: 'e', role: 'admin' } }) as any;
    const res = createRes() as any;

    const middleware = authorize('admin', 'user');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('returns error when req.user is undefined', () => {
    const req = createReq({ user: undefined }) as any;
    const res = createRes() as any;

    const middleware = authorize('admin');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Authentication required') }));
  });

  it('returns 403-like ForbiddenError when role not in allowed list', () => {
    const req = createReq({ user: { id: 'u1', email: 'e', role: 'viewer' } }) as any;
    const res = createRes() as any;

    const middleware = authorize('admin', 'user');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Insufficient permissions') }));
  });

  it('works with single role string', () => {
    const req = createReq({ user: { id: 'u1', email: 'e', role: 'admin' } }) as any;
    const res = createRes() as any;

    const middleware = authorize('admin');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE — rateLimitByUser
// ══════════════════════════════════════════════════════════════════════════════

describe('Auth Middleware — rateLimitByUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips rate limiting and calls next() when no user.id', async () => {
    const req = createReq({ user: { id: undefined as any, email: 'e', role: 'r' } }) as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockLimitApiRequest).not.toHaveBeenCalled();
  });

  it('calls limitApiRequest and sets rate limit headers', async () => {
    mockLimitApiRequest.mockResolvedValueOnce({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60000,
    });

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser('pro');
    await middleware(req, res, next);

    expect(mockLimitApiRequest).toHaveBeenCalledWith('user-1', 'pro');
    expect(res._headers['X-RateLimit-Limit']).toBe(60);
    expect(res._headers['X-RateLimit-Remaining']).toBe(59);
    expect(next).toHaveBeenCalled();
  });

  it('returns 429 when rate limit exceeded', async () => {
    const resetTime = Date.now() + 30000;
    mockLimitApiRequest.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: resetTime,
    });

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser('free');
    await middleware(req, res, next);

    expect(res._status).toBe(429);
    expect(res._body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res._body.retryAfter).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('uses default tier "free" when no tier specified', async () => {
    mockLimitApiRequest.mockResolvedValueOnce({
      success: true,
      limit: 60,
      remaining: 58,
      reset: Date.now() + 60000,
    });

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser();
    await middleware(req, res, next);

    expect(mockLimitApiRequest).toHaveBeenCalledWith('user-1', 'free');
  });

  it('returns 429 when rate limit service throws an error', async () => {
    mockLimitApiRequest.mockRejectedValueOnce(new Error('Redis down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser();
    await middleware(req, res, next);

    expect(res._status).toBe(429);
    expect(res._body.code).toBe('RATE_LIMIT_SERVICE_UNAVAILABLE');
    expect(next).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('sets headers with fallback values when result fields are missing', async () => {
    mockLimitApiRequest.mockResolvedValueOnce({
      success: true,
      limit: undefined,
      remaining: undefined,
      reset: undefined,
    });

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser();
    await middleware(req, res, next);

    expect(res._headers['X-RateLimit-Limit']).toBe(60);
    expect(res._headers['X-RateLimit-Remaining']).toBe(0);
    expect(next).toHaveBeenCalled();
  });

  it('computes retryAfter as 60 seconds when reset is undefined', async () => {
    mockLimitApiRequest.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: undefined,
    });

    const req = createReq() as any;
    const res = createRes() as any;

    const middleware = rateLimitByUser();
    await middleware(req, res, next);

    expect(res._status).toBe(429);
    expect(res._body.retryAfter).toBe(60);
  });
});
