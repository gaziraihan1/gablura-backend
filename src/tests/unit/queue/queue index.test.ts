// src/tests/unit/queue/queue.index.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for queue index — initialization and shutdown.
// NOTE: all former per-domain workers were consolidated into a single
// BullMQ worker (jobs.worker.ts) to cut idle Upstash Redis polling.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Workers ─────────────────────────────────────────────────────────────
vi.mock('../../../queue/workers/jobs.worker.js', () => ({
  createJobsWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  }),
}));

// ── Import queue index after mocks ───────────────────────────────────────────
import { initQueueWorkers, closeQueueWorkers } from '../../../queue/index.js';
import { createJobsWorker } from '../../../queue/workers/jobs.worker.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('Queue Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initQueueWorkers', () => {
    it('initializes the single consolidated worker', async () => {
      await initQueueWorkers();

      expect(createJobsWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeQueueWorkers', () => {
    it('closes the worker and the queue', async () => {
      await initQueueWorkers();
      await closeQueueWorkers();

      const jobsWorker = (createJobsWorker as any).mock.results[0]?.value;
      expect(jobsWorker).toBeDefined();
      expect(jobsWorker.close).toHaveBeenCalled();
    });
  });
});
