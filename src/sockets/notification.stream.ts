import type { Request, Response } from "express";
import { getSubscriber } from "../lib/redis/redis.pubsub.js";
import type { SSEPayload } from "../lib/sse/sse.channels.js";
import { userChannel } from "../lib/sse/sse.channels.js";
import { verifyToken } from "../lib/auth/backendToken.js";

// ─── Per-process connection registry ─────────────────────────────────────────

const localClients = new Map<string, Set<Response>>();

// Three states per channel:
//   "pending"       = SUBSCRIBE sent to Redis, ack not yet received
//   "active"        = Redis confirmed the subscription
//   "pending-unsub" = UNSUBSCRIBE sent, ack not yet received
const channelState = new Map<string, "pending" | "active" | "pending-unsub">();

// ─── Redis subscriber ─────────────────────────────────────────────────────────

const redisSub = getSubscriber();

redisSub.on("message", (channel: string, raw: string) => {
  const userId = channel.replace(/^sse:user:/, "");
  const clients = localClients.get(userId);
    console.log("[SSE] Redis message received on", channel, raw); // add this

  if (!clients || clients.size === 0) return;

  let payload: SSEPayload;
  try {
    payload = JSON.parse(raw) as SSEPayload;
  } catch {
    console.warn("[SSE] Malformed Redis message on", channel);
    return;
  }

  // Unnamed data line — matches es.onmessage on the frontend
  const line = `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
});

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
}, 25_000);

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
  res.flushHeaders();

  // Await subscribe BEFORE writing "connected" — channel is guaranteed active
  // in Redis before the client triggers any action that causes a PUBLISH.
  try {
    await addClient(userId, res);
  } catch {
    console.error("[SSE] Failed to subscribe for user", userId);
    // Continue anyway — DB is durable, client sees notifications on reconnect
  }

  res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

  req.on("close", () => removeClient(userId, res));
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function resetLocalClients(): void {
  localClients.clear();
  channelState.clear();
}

export function getLocalConnectionCount(): number {
  let total = 0;
  for (const [, s] of localClients) total += s.size;
  return total;
}