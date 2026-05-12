/**
 * lib/sse.channels.ts
 *
 * Central source of truth for Redis pub/sub channel names and SSE payload shapes.
 * Import this everywhere instead of hard-coding strings.
 */

/** Build the per-user Redis channel key */
export const userChannel = (userId: string) => `sse:user:${userId}`;

/** SSE event types sent over the wire to the browser */
export type SSEEventType =
  | "notification"    // standard notification object
  | "heartbeat"       // keepalive ping
  | "connected";      // initial handshake ack

export interface SSEPayload {
  type: SSEEventType;
  data: unknown;      // serialised before publish, parsed on subscribe
}

/** Shape of the notification data pushed through the channel */
export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  createdAt: string;  // ISO string
  read: boolean;
  sender?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
}