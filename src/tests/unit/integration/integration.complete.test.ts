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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(5),
    },
    taskAssignee: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    project: {
      count: vi.fn().mockResolvedValue(3),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
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

// ── Mock OAuth token functions for SlackService ─────────────────────────────
// We mock only getValidAccessToken and decryptToken to let SlackService tests
// work, while keeping real implementations of refreshToken and other tested exports.
vi.mock('../../../modules/integration/integration.oauth.js', async () => {
  const actual = await vi.importActual('../../../modules/integration/integration.oauth.js');
  return {
    ...actual,
    getValidAccessToken: vi.fn().mockResolvedValue('xoxb-test-slack-token'),
    decryptToken: vi.fn().mockReturnValue('xoxb-test-slack-token'),
  };
});

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
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
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

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['task-1'] } },
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

      // For GitHub, an invalid signature without webhookSecret on the integration
      // will throw because processWebhookEvent checks `integration.webhookSecret && signature`
      // The mock has webhookSecret set, so it will try to verify
      // This will fail with an Invalid webhook signature error
      await expect(
        IntegrationMutation.processWebhookEvent('github', 'int-1', {}, 'invalid')
      ).rejects.toThrow();
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

// ─── Slack Integration Tests ──────────────────────────────────────────────────

describe('Slack Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('SlackService', () => {
    it('should post a message to Slack', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, channel: 'C123', ts: '1234567890.123456' }),
      });

      const service = new SlackService('int-1');
      const result = await service.postMessage({
        channel: 'C123',
        text: 'Hello from Gablura!',
      });

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('C123');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('chat.postMessage');
    });

    it('should return null on API failure', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockRejectedValueOnce(new Error('Slack API error'));

      const service = new SlackService('int-1');
      const result = await service.postMessage({
        channel: 'C123',
        text: 'Hello',
      });

      expect(result).toBeNull();
    });

    it('should handle Slack API error response', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: false, error: 'not_authorized' }),
      });

      const service = new SlackService('int-1');

      const result = await service.postMessage({ channel: 'C123', text: 'Hello' });
      expect(result).toBeNull();
    });

    it('should fetch conversation history', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          messages: [
            { ts: '123.456', text: 'Hello', user: 'U123', type: 'message' },
            { ts: '123.457', text: 'World', user: 'U456', type: 'message' },
          ],
          has_more: false,
        }),
      });

      const service = new SlackService('int-1');
      const { messages, hasMore } = await service.getConversationHistory({
        channel: 'C123',
        limit: 10,
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe('Hello');
      expect(hasMore).toBe(false);
    });

    it('should handle conversation history error gracefully', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new SlackService('int-1');
      const { messages } = await service.getConversationHistory({
        channel: 'C123',
      });

      expect(messages).toEqual([]);
    });

    it('should add reaction to message', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const service = new SlackService('int-1');
      const result = await service.addReaction({
        channel: 'C123',
        timestamp: '1234567890.123456',
        reaction: 'white_check_mark',
      });

      expect(result).toBe(true);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('reactions.add');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.name).toBe('white_check_mark');
    });
  });

  describe('Slack Webhook Processing', () => {
    it('should process Slack url_verification', async () => {
      const { handleWebhook } = await import('../../../modules/integration/integration.webhook.js');

      const result = await handleWebhook('slack', {
        type: 'url_verification',
        challenge: 'challenge_123',
      });

      expect(result).toEqual({ challenge: 'challenge_123' });
    });

    it('should process Slack slash command create', async () => {
      const { IntegrationMutation } = await import('../../../modules/integration/integration.mutation.js');

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'slack',
        workspaceId: 'ws-1',
        webhookSecret: null,
      });

      (prisma.task.create as any).mockResolvedValue({
        id: 'task-123',
        title: 'Test task from Slack',
        status: 'TODO',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      await IntegrationMutation.processWebhookEvent('slack', 'int-1', {
        command: '/gablura',
        text: 'create Test task from Slack',
        user_id: 'U123',
        user_name: 'testuser',
        channel_id: 'C123',
        channel_name: 'general',
        response_url: 'https://hooks.slack.com/commands/T123/abc',
        trigger_id: 'trigger.123',
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Test task from Slack',
            status: 'TODO',
          }),
        })
      );
    });

    it('should respond with workspace status on status command', async () => {
      const { IntegrationMutation } = await import('../../../modules/integration/integration.mutation.js');

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'slack',
        workspaceId: 'ws-1',
        webhookSecret: null,
      });

      (prisma.task.count as any).mockResolvedValue(10);
      (prisma.project.count as any).mockResolvedValue(3);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      await IntegrationMutation.processWebhookEvent('slack', 'int-1', {
        command: '/gablura',
        text: 'status',
        user_id: 'U123',
        user_name: 'testuser',
        channel_id: 'C123',
        response_url: 'https://hooks.slack.com/commands/T123/abc',
        trigger_id: 'trigger.456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/commands/T123/abc',
        expect.objectContaining({
          body: expect.stringContaining('Workspace Overview'),
        })
      );
    });
  });

  describe('Slack Notifications', () => {
    it('should notify Slack channel on task update', async () => {
      const { notifySlackTaskUpdate } = await import('../../../modules/integration/slack.notifications.js');

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        provider: 'slack',
        workspaceId: 'ws-1',
        active: true,
        config: {
          notifications: true,
          notificationChannel: 'C123',
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, channel: 'C123', ts: '123.456' }),
      });

      await notifySlackTaskUpdate('int-1', {
        taskId: 'task-1',
        title: 'Test Task',
        status: 'COMPLETED',
        changedByName: 'Test User',
        workspaceId: 'ws-1',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('chat.postMessage'),
        expect.any(Object)
      );
    });

    it('should not notify if integration is inactive', async () => {
      const { notifySlackTaskUpdate } = await import('../../../modules/integration/slack.notifications.js');

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.integration.findUnique as any).mockResolvedValue({
        ...mockIntegration,
        active: false,
      });

      mockFetch.mockClear();

      await notifySlackTaskUpdate('int-1', {
        taskId: 'task-1',
        title: 'Test Task',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Slack User Resolution', () => {
    it('should resolve Slack user to Gablura user by email', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          user: {
            id: 'U123',
            profile: { email: 'user@example.com', display_name: 'Test User' },
          },
        }),
      });

      const { prisma } = await import('../../../lib/prisma.js');
      (prisma.user.findUnique as any).mockResolvedValue({ id: 'gablura-user-1' });

      const service = new SlackService('int-1');
      const gabluraUserId = await service.resolveSlackUserToGabluraUserId('U123');

      expect(gabluraUserId).toBe('gablura-user-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'user@example.com' },
        })
      );
    });

    it('should return null if Slack user has no email', async () => {
      const { SlackService } = await import('../../../modules/integration/slack.service.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          user: {
            id: 'U123',
            profile: { display_name: 'No Email User' },
          },
        }),
      });

      const service = new SlackService('int-1');
      const gabluraUserId = await service.resolveSlackUserToGabluraUserId('U123');

      expect(gabluraUserId).toBeNull();
    });
  });

  describe('Slack Configuration Validation', () => {
    it('should accept slack as valid provider', async () => {
      const { createIntegrationSchema } = await import('../../../modules/integration/integration.validators.js');
      const result = createIntegrationSchema.safeParse({ provider: 'slack' });
      expect(result.success).toBe(true);
    });

    it('should accept slack config with notification channel', async () => {
      const { updateIntegrationConfigSchema } = await import('../../../modules/integration/integration.validators.js');
      const result = updateIntegrationConfigSchema.safeParse({
        config: {
          notifications: true,
          notificationChannel: 'C1234567890',
          selectedChannels: ['C123'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid config values', async () => {
      const { updateIntegrationConfigSchema } = await import('../../../modules/integration/integration.validators.js');
      const result = updateIntegrationConfigSchema.safeParse({
        config: {
          syncInterval: 10,
          syncDirection: 'invalid',
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
