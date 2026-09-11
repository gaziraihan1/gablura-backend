/**
 * queue/queues/automation.queue.ts
 */
import { jobsQueue } from './jobs.queue.js';
import type { AutomationEvent } from '../../modules/automation/automation.types.js';

// Legacy alias — retained so existing imports/tests keep working.
export const automationQueue = jobsQueue;

export async function addAutomationEventJob(jobData: AutomationEvent) {
  return jobsQueue.add('automation-event', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}
