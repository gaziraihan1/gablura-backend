import { Queue } from "bullmq";

/**
 * Unified BullMQ queue.
 *
 * Previously the app ran 8 separate queues, each with its own Queue instance
 * AND its own Worker instance. Every BullMQ Worker issues a blocking fetch
 * (`brpoplpush`) that re-issues every ~5 seconds *even when fully idle* —
 * ~17,280 Redis commands/day per worker. With 8 workers that was ~138k
 * commands/day against Upstash with zero traffic.
 *
 * Consolidating into ONE queue + ONE worker keeps identical job semantics
 * (names, priorities, retries, backoff, delays) while cutting idle Redis
 * traffic to ~17k commands/day (~85% reduction).
 */
export const JOBS_QUEUE_NAME = "jobs";

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES ?? "3"),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 50, // Reduced from 100 to reduce Redis memory usage
    removeOnFail: 25,     // Reduced from 50 to reduce Redis memory usage
  },
});
