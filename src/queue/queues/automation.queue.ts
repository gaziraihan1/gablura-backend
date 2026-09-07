/**
 * queue/queues/automation.queue.ts
 */
import { Queue } from 'bullmq';
import type { AutomationEvent } from '../../modules/automation/automation.types.js';

const AUTOMATION_QUEUE_NAME = 'automation';

export const automationQueue = new Queue(AUTOMATION_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES ?? "3"),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100, // Reduced from 200 to reduce Redis memory usage
    removeOnFail: 50,     // Reduced from 100 to reduce Redis memory usage
  },
});

export async function addAutomationEventJob(jobData: AutomationEvent) {
  return automationQueue.add('automation-event', jobData);
}
