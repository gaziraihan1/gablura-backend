import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Queue Functions ─────────────────────────────────────────────────────
vi.mock('../../../queue/index.js', () => ({
  addSyncIntegrationJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  addProcessWebhookJob: vi.fn().mockResolvedValue({ id: 'job-2' }),
}));

vi.mock('../../../queue/queues/integration.queue.js', () => ({
  addSyncIntegrationJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  addProcessWebhookJob: vi.fn().mockResolvedValue({ id: 'job-2' }),
}));

// ── Mock Prisma ──────────────────────────────────────────────────────────────
const { mockIntegration, mockWorkspace, mockTask } = vi.hoisted(() => ({
  mockIntegration: {
    id: 'int-1',
    name: 'GitHub',
    provider: 'github',
    accessToken: 'ghp_test_token',
    refreshToken: null,
    expiresAt: null,
    config: {
      syncDirection: 'one-way',
      autoSync: true,
      syncInterval: 300,
      notifications: true,
      selectedRepos: ['owner/repo'],
    },
    webhookUrl: null,
    webhookSecret: 'webhook_secret_123',
    syncStatus: {
      lastSyncAt: null,
      lastSyncStatus: 'pending',
      syncCount: 0,
    },
    active: true,
    connectedAt: new Date(),
    userId: 'user-1',
    workspaceId: null,
    connectedById: 'user-1',
  },
  mockWorkspace: {
    id: 'ws-1',
    name: 'Test Workspace',
    slug: 'test-workspace',
  },
  mockTask: {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    status: 'TODO',
    workspaceId: 'ws-1',
    createdById: 'user-1',
  },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    integration: {
      findUnique: vi.fn().mockResolvedValue(mockIntegration),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(mockIntegration),
      update: vi.fn().mockResolvedValue(mockIntegration),
      delete: vi.fn().mockResolvedValue(mockIntegration),
      count: vi.fn().mockResolvedValue(0),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue(mockWorkspace),
    },
    workspaceMember: {
      findFirst: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
    },
    task: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(mockTask),
      update: vi.fn().mockResolvedValue(mockTask),
      count: vi.fn().mockResolvedValue(5),
    },
  },
}));

// ── Mock Redis ───────────────────────────────────────────────────────────────
vi.mock('../../../redis/redis.client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue('csrf_token'),
    del: vi.fn().mockResolvedValue(1),
    status: 'ready',
  }),
}));

// ── Mock Errors ──────────────────────────────────────────────────────────────
vi.mock('../../../errors/index.js', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string, public issues?: any[]) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(entity: string) {
      super(`${entity} not found`);
      this.name = 'NotFoundError';
    }
  },
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ForbiddenError';
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ConflictError';
    }
  },
  asyncHandler: (fn: any) => fn,
}));

// ── Mock fetch ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─────────────────────────────────────────────────────────────────────────────

import { IntegrationMutation } from '../../../modules/integration/integration.mutation.js';
import { IntegrationAccess } from '../../../modules/integration/integration.access.js';
import { refreshToken } from '../../../modules/integration/integration.oauth.js';
import { addSyncIntegrationJob } from '../../../queue/queues/integration.queue.js';

describe('Integration Module - Complete Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Access Control Tests ──────────────────────────────────────────────────

  describe('IntegrationAccess', () => {
    it('should allow owner to view personal integration', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        userId: 'user-1',
      });

      const canView = await IntegrationAccess.canView('int-1', 'user-1');
      expect(canView).toBe(true);
    });

    it('should deny non-owner from viewing personal integration', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        userId: 'user-1',
      });

      const canView = await IntegrationAccess.canView('int-1', 'user-2');
      expect(canView).toBe(false);
    });

    it('should allow workspace member to view workspace integration', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        userId: null,
        workspaceId: 'ws-1',
      });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'MEMBER',
      });

      const canView = await IntegrationAccess.canView('int-1', 'user-2');
      expect(canView).toBe(true);
    });

    it('should allow admin to manage workspace integration', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        userId: null,
        workspaceId: 'ws-1',
      });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'ADMIN',
      });

      const canManage = await IntegrationAccess.canManage('int-1', 'user-1');
      expect(canManage).toBe(true);
    });

    it('should deny non-admin from managing workspace integration', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        userId: null,
        workspaceId: 'ws-1',
      });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'MEMBER',
      });

      const canManage = await IntegrationAccess.canManage('int-1', 'user-2');
      expect(canManage).toBe(false);
    });
  });

  // ─── Sync Tests ────────────────────────────────────────────────────────────

  describe('IntegrationMutation.triggerSync', () => {
    it('should add sync job to queue', async () => {
      await IntegrationMutation.triggerSync('int-1', 'user-1');

      expect(addSyncIntegrationJob).toHaveBeenCalledWith({
        integrationId: 'int-1',
        userId: 'user-1',
      });
    });

    it('should return sync ID', async () => {
      const result = await IntegrationMutation.triggerSync('int-1', 'user-1');

      expect(result).toHaveProperty('syncId');
    });
  });

  describe('IntegrationMutation.performSync', () => {
    it('should perform GitHub sync', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: 1, title: 'Issue 1', state: 'open' },
        ]),
      });

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'github',
        config: {
          selectedRepos: ['owner/repo'],
        },
      });

      await IntegrationMutation.performSync('int-1');

      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1' },
          data: expect.objectContaining({
            syncStatus: expect.objectContaining({
              lastSyncStatus: 'success',
            }),
          }),
        })
      );
    });

    it('should handle sync failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API Error'));

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'github',
        config: {
          selectedRepos: ['owner/repo'],
        },
      });

      await IntegrationMutation.performSync('int-1');

      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1' },
          data: expect.objectContaining({
            syncStatus: expect.objectContaining({
              lastSyncStatus: 'failed',
            }),
          }),
        })
      );
    });
  });

  // ─── Webhook Processing Tests ─────────────────────────────────────────────

  describe('IntegrationMutation.processWebhookEvent', () => {
    it('should process GitHub PR merge webhook', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        webhookSecret: null,
      });
      (prisma.task.findMany as any).mockResolvedValue([
        { id: 'task-1', title: 'Fix bug #123' },
      ]);

      await IntegrationMutation.processWebhookEvent('github', 'int-1', {
        action: 'closed',
        pull_request: {
          number: 123,
          merged: true,
          title: 'Fix bug',
        },
        repository: {
          full_name: 'owner/repo',
        },
      });

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
    });

    it('should process GitHub issue opened webhook', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        webhookSecret: null,
        config: {
          selectedRepos: ['owner/repo'],
        },
      });
      (prisma.task.findFirst as any).mockResolvedValue(null);

      await IntegrationMutation.processWebhookEvent('github', 'int-1', {
        action: 'opened',
        issue: {
          title: 'New feature request',
          body: 'Please add feature X',
        },
        repository: {
          full_name: 'owner/repo',
        },
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'New feature request',
            status: 'TODO',
          }),
        })
      );
    });

    it('should verify webhook signature', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        webhookSecret: 'secret123',
      });

      // Invalid signature should throw
      await expect(
        IntegrationMutation.processWebhookEvent('github', 'int-1', {}, 'invalid_signature')
      ).rejects.toThrow('Invalid webhook signature');
    });
  });

  // ─── Configuration Tests ──────────────────────────────────────────────────

  describe('IntegrationMutation.updateConfig', () => {
    it('should merge config with existing', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        config: {
          syncDirection: 'one-way',
          autoSync: true,
        },
      });

      await IntegrationMutation.updateConfig('int-1', {
        syncInterval: 600,
      }, 'user-1');

      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1' },
          data: {
            config: {
              syncDirection: 'one-way',
              autoSync: true,
              syncInterval: 600,
            },
          },
        })
      );
    });
  });

  // ─── Disconnect Tests ─────────────────────────────────────────────────────

  describe('IntegrationMutation.disconnectIntegration', () => {
    it('should revoke tokens and delete integration', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'github',
      });

      await IntegrationMutation.disconnectIntegration('int-1', 'user-1');

      expect(prisma.integration.delete).toHaveBeenCalledWith({
        where: { id: 'int-1' },
      });
    });
  });

  // ─── Token Refresh Tests ──────────────────────────────────────────────────

  describe('IntegrationMutation.refreshToken', () => {
    it('should refresh Google token', async () => {
      process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-client-secret';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600,
        }),
      });

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'google-calendar',
        refreshToken: 'old_refresh_token',
        expiresAt: new Date(Date.now() - 1000), // expired
      });

      const token = await refreshToken('int-1');

      expect(token).toBe('new_access_token');
      expect(prisma.integration.update).toHaveBeenCalled();

      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
      delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    });

    it('should return existing token if not expired', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'github',
        refreshToken: 'some_refresh_token',
        expiresAt: new Date(Date.now() + 3600000), // not expired
      });

      const token = await refreshToken('int-1');

      expect(token).toBe('ghp_test_token');
    });
  });
});
