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
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});

export async function addAutomationEventJob(jobData: AutomationEvent) {
  return automationQueue.add('automation-event', jobData);
}
