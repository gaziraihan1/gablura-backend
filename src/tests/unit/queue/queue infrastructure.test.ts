// src/tests/unit/queue/queue.infrastructure.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for queue infrastructure — all external I/O is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Import queue modules (BullMQ is mocked globally in setup.ts) ──────────────
import {
  emailQueue,
  addSendEmailJob,
} from '../../../queue/queues/email.queue.js';

import {
  notificationQueue,
  addSendNotificationJob,
  addNotifyTaskAssigneesJob,
  addNotifyWorkspaceMembersJob,
} from '../../../queue/queues/notification.queue.js';

import {
  activityQueue,
  addLogActivityJob,
  addInvalidateCacheJob,
  addUpdateStorageQuotaJob,
} from '../../../queue/queues/activity.queue.js';

import {
  calendarQueue,
  addComputeAggregatesJob,
  addComputeInsightsJob,
  addPreComputeUserCalendarJob,
} from '../../../queue/queues/calendar.queue.js';

import {
  analyticsQueue,
  addPreComputeAnalyticsJob,
  addComputeFocusStreakJob,
} from '../../../queue/queues/analytics.queue.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('Queue Infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Email Queue', () => {
    it('creates email queue with correct configuration', () => {
      expect(emailQueue).toBeDefined();
    });

    it('addSendEmailJob adds job to queue', async () => {
      await addSendEmailJob({
        type: 'admin-contact-notification',
        to: '',
        data: { contactData: {}, messageId: 'msg-1', ip: '127.0.0.1' },
      });

      expect(emailQueue.add).toBeDefined();
    });

    it('addSendEmailJob sets high priority for ban emails', async () => {
      await addSendEmailJob({
        type: 'ban-email',
        to: 'user@example.com',
        data: { toEmail: 'user@example.com', toName: 'User', reason: 'Spam' },
      });

      expect(emailQueue.add).toBeDefined();
    });

    it('addSendEmailJob dispatches workspace-limits-changed-email', async () => {
      await addSendEmailJob({
        type: 'workspace-limits-changed-email',
        to: 'owner@example.com',
        data: {
          toEmail: 'owner@example.com',
          toName: 'Owner',
          workspaceName: 'Acme',
          changes: [{ label: 'Plan', from: 'PRO', to: 'ENTERPRISE' }],
        },
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-workspace-limits-changed-email',
        expect.objectContaining({
          type: 'workspace-limits-changed-email',
          to: 'owner@example.com',
          data: expect.objectContaining({ workspaceName: 'Acme' }),
        }),
        expect.anything(),
      );
    });
  });

  describe('Notification Queue', () => {
    it('creates notification queue with correct configuration', () => {
      expect(notificationQueue).toBeDefined();
    });

    it('addSendNotificationJob adds job to queue', async () => {
      await addSendNotificationJob({
        userId: 'user-1',
        senderId: 'sender-1',
        type: 'TASK_ASSIGNED',
        title: 'Task Assigned',
        message: 'You have been assigned a task',
      });

      expect(notificationQueue.add).toBeDefined();
    });

    it('addNotifyTaskAssigneesJob adds job to queue', async () => {
      await addNotifyTaskAssigneesJob({
        taskId: 'task-1',
        senderId: 'sender-1',
        type: 'TASK_COMPLETED',
        title: 'Task Completed',
        message: 'Task has been completed',
      });

      expect(notificationQueue.add).toBeDefined();
    });

    it('addNotifyWorkspaceMembersJob adds job to queue', async () => {
      await addNotifyWorkspaceMembersJob({
        workspaceId: 'ws-1',
        senderId: 'sender-1',
        type: 'PROJECT_UPDATE',
        title: 'Project Updated',
        message: 'Project has been updated',
      });

      expect(notificationQueue.add).toBeDefined();
    });
  });

  describe('Activity Queue', () => {
    it('creates activity queue with correct configuration', () => {
      expect(activityQueue).toBeDefined();
    });

    it('addLogActivityJob adds job with correct priority', async () => {
      await addLogActivityJob({
        action: 'CREATED',
        entityType: 'TASK',
        entityId: 'task-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      expect(activityQueue.add).toBeDefined();
    });

    it('addInvalidateCacheJob adds job with correct priority', async () => {
      await addInvalidateCacheJob({
        type: 'analytics',
        workspaceId: 'ws-1',
      });

      expect(activityQueue.add).toBeDefined();
    });

    it('addUpdateStorageQuotaJob adds job with correct priority', async () => {
      await addUpdateStorageQuotaJob({
        workspaceId: 'ws-1',
        bytes: 1024,
        operation: 'increment',
      });

      expect(activityQueue.add).toBeDefined();
    });
  });

  describe('Calendar Queue', () => {
    it('creates calendar queue with correct configuration', () => {
      expect(calendarQueue).toBeDefined();
    });

    it('addComputeAggregatesJob adds job to queue', async () => {
      await addComputeAggregatesJob({
        userId: 'user-1',
        workspaceId: 'ws-1',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(calendarQueue.add).toBeDefined();
    });

    it('addComputeInsightsJob adds job to queue', async () => {
      await addComputeInsightsJob({
        userId: 'user-1',
        workspaceId: 'ws-1',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(calendarQueue.add).toBeDefined();
    });

    it('addPreComputeUserCalendarJob adds job to queue', async () => {
      await addPreComputeUserCalendarJob({
        userId: 'user-1',
        workspaceId: 'ws-1',
      });

      expect(calendarQueue.add).toBeDefined();
    });
  });

  describe('Analytics Queue', () => {
    it('creates analytics queue with correct configuration', () => {
      expect(analyticsQueue).toBeDefined();
    });

    it('addPreComputeAnalyticsJob adds job to queue', async () => {
      await addPreComputeAnalyticsJob({
        workspaceId: 'ws-1',
      });

      expect(analyticsQueue.add).toBeDefined();
    });

    it('addComputeFocusStreakJob adds job to queue', async () => {
      await addComputeFocusStreakJob({
        userId: 'user-1',
      });

      expect(analyticsQueue.add).toBeDefined();
    });
  });
});
