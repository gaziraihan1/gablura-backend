// src/tests/unit/queue/queue.index.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for queue index — initialization and shutdown.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Workers ─────────────────────────────────────────────────────────────
vi.mock('../../../queue/workers/email.worker.js', () => ({
  createEmailWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../queue/workers/notification.worker.js', () => ({
  createNotificationWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../queue/workers/activity.worker.js', () => ({
  createActivityWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../queue/workers/calendar.worker.js', () => ({
  createCalendarWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../queue/workers/analytics.worker.js', () => ({
  createAnalyticsWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../../queue/workers/integration.worker.js', () => ({
  createIntegrationWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

// ── Import queue index after mocks ───────────────────────────────────────────
import { initQueueWorkers, closeQueueWorkers } from '../../../queue/index.js';
import { createEmailWorker } from '../../../queue/workers/email.worker.js';
import { createNotificationWorker } from '../../../queue/workers/notification.worker.js';
import { createActivityWorker } from '../../../queue/workers/activity.worker.js';
import { createCalendarWorker } from '../../../queue/workers/calendar.worker.js';
import { createAnalyticsWorker } from '../../../queue/workers/analytics.worker.js';
import { createIntegrationWorker } from '../../../queue/workers/integration.worker.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('Queue Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initQueueWorkers', () => {
    it('initializes all 6 workers', async () => {
      await initQueueWorkers();

      expect(createEmailWorker).toHaveBeenCalled();
      expect(createNotificationWorker).toHaveBeenCalled();
      expect(createActivityWorker).toHaveBeenCalled();
      expect(createCalendarWorker).toHaveBeenCalled();
      expect(createAnalyticsWorker).toHaveBeenCalled();
      expect(createIntegrationWorker).toHaveBeenCalled();
    });
  });

  describe('closeQueueWorkers', () => {
    it('closes all workers and queues', async () => {
      await initQueueWorkers();
      await closeQueueWorkers();

      const emailWorker = (createEmailWorker as any).mock.results[0]?.value;
      const notificationWorker = (createNotificationWorker as any).mock.results[0]?.value;
      const activityWorker = (createActivityWorker as any).mock.results[0]?.value;
      const calendarWorker = (createCalendarWorker as any).mock.results[0]?.value;
      const analyticsWorker = (createAnalyticsWorker as any).mock.results[0]?.value;
      const integrationWorker = (createIntegrationWorker as any).mock.results[0]?.value;

      if (emailWorker) expect(emailWorker.close).toHaveBeenCalled();
      if (notificationWorker) expect(notificationWorker.close).toHaveBeenCalled();
      if (activityWorker) expect(activityWorker.close).toHaveBeenCalled();
      if (calendarWorker) expect(calendarWorker.close).toHaveBeenCalled();
      if (analyticsWorker) expect(analyticsWorker.close).toHaveBeenCalled();
      if (integrationWorker) expect(integrationWorker.close).toHaveBeenCalled();
    });
  });
});
