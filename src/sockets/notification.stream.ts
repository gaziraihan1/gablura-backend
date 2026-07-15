import type { Request, Response } from "express";
import { getSubscriber } from "../lib/redis/redis.pubsub.js";
import type { SSEPayload } from "../lib/sse/sse.channels.js";
import { userChannel } from "../lib/sse/sse.channels.js";
import { verifyToken } from "../lib/auth/backendToken.js";
import { getRedisClient } from "../redis/redis.client.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 100;
const HEARTBEAT_INTERVAL_MS = 25_000;
const DELIVERY_TRACKING_TTL = 3600; // 1 hour

// ─── Per-process connection registry ─────────────────────────────────────────

const localClients = new Map<string, Set<Response>>();

// Three states per channel:
//   "pending"       = SUBSCRIBE sent to Redis, ack not yet received
//   "active"        = Redis confirmed the subscription
//   "pending-unsub" = UNSUBSCRIBE sent, ack not yet received
const channelState = new Map<string, "pending" | "active" | "pending-unsub">();

// ─── Delivery tracking ───────────────────────────────────────────────────────

interface DeliveryAttempt {
  notificationId: string;
  userId: string;
  timestamp: number;
  success: boolean;
  attempts: number;
  error?: string;
}

const deliveryLog: DeliveryAttempt[] = [];
const MAX_DELIVERY_LOG_SIZE = 1000;

function logDelivery(attempt: DeliveryAttempt): void {
  deliveryLog.push(attempt);
  if (deliveryLog.length > MAX_DELIVERY_LOG_SIZE) {
    deliveryLog.shift();
  }

  // Also persist to Redis for cross-process visibility
  try {
    const redis = getRedisClient();
    const key = `sse:delivery:${attempt.userId}:${attempt.notificationId}`;
    redis.setex(
      key,
      DELIVERY_TRACKING_TTL,
      JSON.stringify({
        success: attempt.success,
        attempts: attempt.attempts,
        timestamp: attempt.timestamp,
        error: attempt.error,
      }),
    ).catch(() => {}); // Best effort
  } catch {
    // Redis unavailable - log only locally
  }
}

// ─── Redis subscriber ─────────────────────────────────────────────────────────

const redisSub = getSubscriber();

redisSub.on("message", (channel: string, raw: string) => {
  const userId = channel.replace(/^sse:user:/, "");
  const clients = localClients.get(userId);

  if (!clients || clients.size === 0) return;

  let payload: SSEPayload;
  try {
    payload = JSON.parse(raw) as SSEPayload;
  } catch {
    console.warn("[SSE] Malformed Redis message on", channel);
    return;
  }

  // Extract notification ID for tracking
  const notificationId = (payload.data as any)?.id ?? "unknown";

  // Write with retry logic
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  let successCount = 0;
  let failCount = 0;

  for (const res of clients) {
    const writeSuccess = writeWithRetry(res, line, MAX_RETRY_ATTEMPTS);
    if (writeSuccess) {
      successCount++;
    } else {
      failCount++;
      // Remove failed client
      clients.delete(res);
    }
  }

  // Log delivery attempt
  logDelivery({
    notificationId,
    userId,
    timestamp: Date.now(),
    success: successCount > 0,
    attempts: 1,
    error: failCount > 0 ? `${failCount} clients failed` : undefined,
  });
});

// ─── Write with retry ────────────────────────────────────────────────────────

function writeWithRetry(res: Response, data: string, maxAttempts: number): boolean {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res.write(data);
      return true;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(
          `[SSE] Write failed after ${maxAttempts} attempts:`,
          (err as Error).message,
        );
        return false;
      }
      // Brief delay before retry (synchronous for simplicity)
      const start = Date.now();
      while (Date.now() - start < RETRY_DELAY_MS * attempt) {
        // Busy wait - acceptable for short delays
      }
    }
  }
  return false;
}

// ─── Subscribe helper ─────────────────────────────────────────────────────────

function subscribeToChannel(channel: string): Promise<void> {
  const state = channelState.get(channel);

  // Already subscribed or in-flight — nothing to do
  if (state === "active" || state === "pending") {
    return Promise.resolve();
  }

  channelState.set(channel, "pending");

  return new Promise((resolve, reject) => {
    redisSub.subscribe(channel, (err) => {
      if (err) {
        channelState.delete(channel);
        console.error("[SSE] subscribe error", channel, err.message);
        reject(err);
      } else {
        channelState.set(channel, "active");
        resolve();
      }
    });
  });
}

function unsubscribeFromChannel(channel: string): void {
  channelState.set(channel, "pending-unsub");
  redisSub.unsubscribe(channel, (err) => {
    if (err) {
      // Rollback so next addClient can re-subscribe correctly
      channelState.set(channel, "active");
      console.error("[SSE] unsubscribe error", channel, err.message);
    } else {
      channelState.delete(channel);
    }
  });
}

// ─── Client registry ──────────────────────────────────────────────────────────

async function addClient(userId: string, res: Response): Promise<void> {
  if (!localClients.has(userId)) {
    localClients.set(userId, new Set());
  }
  localClients.get(userId)!.add(res);

  // Await subscribe so the channel is live in Redis before we return.
  // The "connected" write happens after, so no PUBLISH can be missed.
  await subscribeToChannel(userChannel(userId));
}

function removeClient(userId: string, res: Response): void {
  const clients = localClients.get(userId);
  if (!clients) return;

  clients.delete(res);

  if (clients.size === 0) {
    localClients.delete(userId);
    unsubscribeFromChannel(userChannel(userId));
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

// Skip heartbeat interval during tests to prevent process hanging.
// In test mode the handler is tested via fake timers; no real interval needed.
const isTest =
  process.env.NODE_ENV === 'test' || typeof (globalThis as any).__vitest !== 'undefined';

if (!isTest) {
  setInterval(() => {
    for (const [, clients] of localClients) {
      for (const res of clients) {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          // cleaned up on next removeClient
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ─── SSE stream handler ───────────────────────────────────────────────────────

export async function notificationStreamHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(401).json({ success: false, message: "Missing token" });
    return;
  }

  let userId: string;
  try {
    const payload = verifyToken(token);
    userId = payload.id;
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-SSE-Retry-After", "30"); // Hint for frontend reconnect interval
  res.flushHeaders();

  // Await subscribe BEFORE writing "connected" — channel is guaranteed active
  // in Redis before the client triggers any action that causes a PUBLISH.
  try {
    await addClient(userId, res);
  } catch {
    console.error("[SSE] Failed to subscribe for user", userId);
    // Continue anyway — DB is durable, client sees notifications on reconnect
  }

  // Send connection confirmation with user info
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      userId,
      timestamp: new Date().toISOString(),
    })}\n\n`,
  );

  req.on("close", () => removeClient(userId, res));
}

// ─── Metrics & Monitoring ─────────────────────────────────────────────────────

export function resetLocalClients(): void {
  localClients.clear();
  channelState.clear();
}

export function getLocalConnectionCount(): number {
  let total = 0;
  for (const [, s] of localClients) total += s.size;
  return total;
}

export function getDeliveryStats(): {
  totalAttempts: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  recentFailures: DeliveryAttempt[];
} {
  const totalAttempts = deliveryLog.length;
  const successfulDeliveries = deliveryLog.filter((d) => d.success).length;
  const failedDeliveries = deliveryLog.filter((d) => !d.success).length;
  const recentFailures = deliveryLog
    .filter((d) => !d.success)
    .slice(-10); // Last 10 failures

  return {
    totalAttempts,
    successfulDeliveries,
    failedDeliveries,
    recentFailures,
  };
}

export function getChannelStates(): Map<string, string> {
  const states = new Map<string, string>();
  for (const [channel, state] of channelState) {
    states.set(channel, state);
  }
  return states;
}
