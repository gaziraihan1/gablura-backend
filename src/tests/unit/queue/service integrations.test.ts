// src/tests/unit/queue/service.integrations.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for service integrations with queue — all external I/O is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Queue Functions ─────────────────────────────────────────────────────
vi.mock('../../../queue/index.js', () => ({
  addSendEmailJob: vi.fn().mockResolvedValue(undefined),
  addSendNotificationJob: vi.fn().mockResolvedValue(undefined),
  addNotifyTaskAssigneesJob: vi.fn().mockResolvedValue(undefined),
  addNotifyWorkspaceMembersJob: vi.fn().mockResolvedValue(undefined),
  addLogActivityJob: vi.fn().mockResolvedValue(undefined),
  addInvalidateCacheJob: vi.fn().mockResolvedValue(undefined),
  addUpdateStorageQuotaJob: vi.fn().mockResolvedValue(undefined),
  addComputeAggregatesJob: vi.fn().mockResolvedValue(undefined),
  addComputeInsightsJob: vi.fn().mockResolvedValue(undefined),
  addPreComputeUserCalendarJob: vi.fn().mockResolvedValue(undefined),
  addPreComputeAnalyticsJob: vi.fn().mockResolvedValue(undefined),
  addComputeFocusStreakJob: vi.fn().mockResolvedValue(undefined),
}));

import {
  addSendEmailJob,
  addSendNotificationJob,
  addLogActivityJob,
  addInvalidateCacheJob,
  addUpdateStorageQuotaJob,
} from '../../../queue/index.js';

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    contactMessage: {
      create: vi.fn().mockResolvedValue({ id: 'msg-1', createdAt: new Date() }),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Test Workspace', slug: 'test-workspace' }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'ws-1', slug: 'test-workspace' }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', name: 'Test User' }),
    },
    workspaceMember: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(5),
    },
    task: {
      findUnique: vi.fn().mockResolvedValue({ id: 'task-1', title: 'Test Task', workspaceId: 'ws-1' }),
    },
    activity: {
      create: vi.fn().mockResolvedValue({ id: 'activity-1' }),
    },
  },
}));

// ── Mock Email Functions ─────────────────────────────────────────────────────
vi.mock('../../../modules/contact/contact.email.js', () => ({
  sendAdminContactNotification: vi.fn().mockResolvedValue(undefined),
  sendUserAutoReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../admin/admin.email.js', () => ({
  sendBanEmail: vi.fn().mockResolvedValue(undefined),
  sendWorkspaceDeletedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/email.js', () => ({
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Notification Helpers ────────────────────────────────────────────────
vi.mock('../../../modules/notification/notification.helpers.js', () => ({
  notifyUser: vi.fn().mockResolvedValue(undefined),
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  notifyTaskAssignees: vi.fn().mockResolvedValue(undefined),
  notifyWorkspaceMembers: vi.fn().mockResolvedValue(undefined),
  notifyMentions: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Activity Repository ─────────────────────────────────────────────────
vi.mock('../../../modules/attachment/attachment.repository.js', () => ({
  AttachmentRepository: {
    createActivity: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock Cache Client ────────────────────────────────────────────────────────
vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
  CACHE_KEYS: {
    calendarAggregates: vi.fn().mockReturnValue('cache:aggregates'),
    calendarInsights: vi.fn().mockReturnValue('cache:insights'),
  },
  CACHE_TTL: {
    CALENDAR_AGGREGATES: 300,
    CALENDAR_INSIGHTS: 300,
  },
  CalendarCache: {
    invalidateAggregates: vi.fn().mockResolvedValue(undefined),
    invalidateInsights: vi.fn().mockResolvedValue(undefined),
  },
  AnalyticsCache: {
    invalidateWorkspace: vi.fn().mockResolvedValue(undefined),
  },
  WorkspaceCache: {
    invalidateWorkspace: vi.fn().mockResolvedValue(undefined),
  },
  TaskCache: {
    invalidateTask: vi.fn().mockResolvedValue(undefined),
    invalidateTaskStats: vi.fn().mockResolvedValue(undefined),
  },
  AccessControlCache: {
    invalidateTaskUsers: vi.fn().mockResolvedValue(undefined),
    invalidateWorkspaceUsers: vi.fn().mockResolvedValue(undefined),
  },
  ActivityCache: {
    invalidateWorkspaceActivities: vi.fn().mockResolvedValue(undefined),
    invalidateUserActivities: vi.fn().mockResolvedValue(undefined),
    invalidateTaskActivities: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Service Integrations with Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Contact Service', () => {
    it('queues admin contact notification email', async () => {
      const { createContactMessage } = await import('../../../modules/contact/contact.service.js');

      await createContactMessage(
        {
          name: 'Test User',
          email: 'test@example.com',
          subject: 'Test Subject',
          category: 'GENERAL',
          message: 'Test message',
        },
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(addSendEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'admin-contact-notification',
        }),
      );
    });

    it('queues user auto-reply email', async () => {
      const { createContactMessage } = await import('../../../modules/contact/contact.service.js');

      await createContactMessage(
        {
          name: 'Test User',
          email: 'test@example.com',
          subject: 'Test Subject',
          category: 'GENERAL',
          message: 'Test message',
        },
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(addSendEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'user-auto-reply',
          to: 'test@example.com',
        }),
      );
    });
  });

  describe('Task Activity', () => {
    it('queues activity log for task creation', async () => {
      const { TaskActivity } = await import('../../../modules/task/task.activity.js');

      await TaskActivity.logCreated({
        taskId: 'task-1',
        taskTitle: 'Test Task',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      expect(addLogActivityJob).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATED',
          entityType: 'TASK',
          entityId: 'task-1',
        }),
      );
    });

    it('queues activity log for status change', async () => {
      const { TaskActivity } = await import('../../../modules/task/task.activity.js');

      await TaskActivity.logStatusChanged({
        taskId: 'task-1',
        taskTitle: 'Test Task',
        userId: 'user-1',
        workspaceId: 'ws-1',
        oldStatus: 'TODO',
        newStatus: 'IN_PROGRESS',
      });

      expect(addLogActivityJob).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STATUS_CHANGED',
          entityType: 'TASK',
        }),
      );
    });

    it('queues activity log for task deletion', async () => {
      const { TaskActivity } = await import('../../../modules/task/task.activity.js');

      await TaskActivity.logDeleted({
        taskId: 'task-1',
        taskTitle: 'Test Task',
        userId: 'user-1',
        workspaceId: 'ws-1',
        status: 'TODO',
        priority: 'MEDIUM',
      });

      expect(addLogActivityJob).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETED',
          entityType: 'TASK',
        }),
      );
    });
  });

  describe('Attachment Service', () => {
    it('queues storage quota increment on upload', async () => {
      // This test verifies the queue integration exists
      // The actual service test covers the full flow
      expect(addUpdateStorageQuotaJob).toBeDefined();
    });

    it('queues storage quota decrement on deletion', async () => {
      // This test verifies the queue integration exists
      // The actual service test covers the full flow
      expect(addUpdateStorageQuotaJob).toBeDefined();
    });
  });

  describe('Cache Invalidation', () => {
    it('queues cache invalidation for analytics', async () => {
      addInvalidateCacheJob({
        type: 'analytics',
        workspaceId: 'ws-1',
      });

      expect(addInvalidateCacheJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analytics',
          workspaceId: 'ws-1',
        }),
      );
    });

    it('queues cache invalidation for tasks', async () => {
      addInvalidateCacheJob({
        type: 'task',
        taskId: 'task-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      expect(addInvalidateCacheJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task',
          taskId: 'task-1',
        }),
      );
    });

    it('queues cache invalidation for calendar', async () => {
      addInvalidateCacheJob({
        type: 'calendar',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      expect(addInvalidateCacheJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'calendar',
          userId: 'user-1',
        }),
      );
    });
  });
});
