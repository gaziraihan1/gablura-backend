# Authentication System

This document describes the authentication architecture, covering JWT-based flows, token exchange, server-sent events (SSE), rate limiting, and React client integration.

---

## Architecture Overview

```
Browser                  Next.js (NextAuth)           Express Backend
   |                           |                              |
   |── login ────────────────>|                              |
   |                           |── /auth/exchange ──────────>|
   |                           |   HMAC-signed proof          |── verify HMAC
   |                           |                              |── issue RS256 tokens
   |                           |<── { accessToken,            |
   |                           |     refreshToken,            |
   |                           |     sseToken }               |
   |<── session cookie ───────|   stored in HTTP-only JWT    |
   |                           |                              |
   |── GET /api/version/data ─────────────────────────────────────>|
   |   Authorization: Bearer <accessToken>                    |── verifyToken()
   |<── data ────────────────────────────────────────────────|   (public key only)
```

**Core principles:**

- The backend is the **sole authority** for signing JWTs — the private key never leaves the Express server
- The frontend (Next.js) manages sessions via NextAuth cookies only — no signing, no private key
- The browser never directly sees the refresh token — it lives inside the HTTP-only NextAuth JWT cookie
- All tokens are RS256-signed with a version field for global invalidation

---

## Token Model

### Access Token

| Property  | Value                        |
|-----------|------------------------------|
| Algorithm | RS256                        |
| Expiry    | 15 minutes                   |
| Audience  | `focura-backend`             |
| Stored    | Inside NextAuth session (HTTP-only cookie) |

**Payload:**

```json
{
  "sub": "userId",
  "email": "user@example.com",
  "role": "USER",
  "type": "access",
  "version": 1,
  "jti": "uuid-v4",
  "sid": "sessionId"
}
```

- `jti` — unique per token, used for revocation via Redis
- `sid` — ties the token to a specific login session
- `version` — increment `CURRENT_TOKEN_VERSION` in `backendToken.ts` to globally invalidate all tokens

---

### Refresh Token

| Property  | Value                        |
|-----------|------------------------------|
| Algorithm | RS256                        |
| Expiry    | 7 days                       |
| Stored    | Redis (JTI tracked per user) |
| Rotated   | On every use                 |

- Every refresh call issues a **new token pair** and invalidates the old refresh token JTI
- If an already-rotated JTI is presented, it is treated as a **replay attack** and logged as `TOKEN_REPLAY_DETECTED`
- `revokeAllRefreshTokens(userId)` supports logout-from-all-devices
- Duplicate/concurrent refresh requests for the same old JTI are handled idempotently for a short window to avoid false replay outcomes during network retries

---

## Token Exchange Flow

After NextAuth authenticates the user, the `jwt` callback calls `/api/auth/exchange` **server-side** (never from the browser) to obtain RS256 tokens from the backend.

### Why HMAC proof instead of a separate exchange token?

The frontend proves the request came from the Next.js server by sending an HMAC-SHA256 signature computed with `NEXTAUTH_SECRET` (shared between frontend and backend). This is stateless and requires no extra round-trip.

### Exchange request

```
POST /api/v1/auth/exchange
Content-Type: application/json

{
  "userId":    "cml4r530o0003...",
  "email":     "user@example.com",
  "role":      "USER",
  "sessionId": "uuid-v4",
  "timestamp": 1234567890123,
  "signature": "hmac-sha256-hex"
}
```

**Signature construction:**

```ts
const payload   = `${userId}${email}${role}${sessionId}${timestamp}`;
const signature = crypto
  .createHmac("sha256", process.env.NEXTAUTH_SECRET)
  .update(payload)
  .digest("hex");
```

**Backend validation:**

1. Recomputes HMAC and compares with `crypto.timingSafeEqual`
2. Rejects proofs older than 60 seconds (replay protection)
3. Verifies the user exists and email is verified
4. Issues an RS256 token pair **plus a 30-second, single-use SSE token**
   (`sseToken`), stores the refresh token JTI and the SSE token JTI in Redis

---

## Token Refresh Flow

The NextAuth `jwt` callback silently refreshes the access token 1 minute before expiry.

```
jwt callback fires (on every request)
  │
  ├── token still valid? → return as-is
  │
  └── near expiry?
        │
        ├── refreshLock exists for this sessionId?
        │     └── wait for in-flight promise (prevents duplicate rotation)
        │
        └── call POST /api/v1/auth/refresh
              │
              ├── success → update token pair in JWT cookie
              ├── duplicate in-flight refresh with same old JTI
              │     └── receives cached successful refresh response
              └── failure → clear backendToken, keep session alive
                           (next API call gets 401, user is NOT logged out)
```

**Key design decision:** Neither `exchangeForTokens` nor `silentRefresh` ever throws. Any error degrades the session gracefully instead of triggering NextAuth's automatic `signOut()`.

### Refresh endpoint

```
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "..." }
```

**Response:**

```json
{
  "accessToken":        "...",
  "refreshToken":       "...",
  "sseToken":           "...",  // 30s, single-use, for the notification stream
  "accessTokenExpiry":  1234567890123,
  "refreshTokenExpiry": 1234567890123
}
```

---

## Server-Sent Events (SSE)

The SSE stream is **authenticated** via a **30-second, single-use SSE token**
(`sseToken`) passed as a query param (EventSource does not support custom
headers). The 15-minute access token is never used here, so it can never leak
into URLs, proxy logs, or browser history.

The backend verifies the token (type `sse`), atomically **consumes** it from
Redis (single-use — replaying a used token returns `401`), and only then opens
the stream. The `userId` in the URL is never trusted.

### Endpoint

```
GET /api/v1/notifications/stream?token=<sseToken>
```

### Security model

```
Client sends:  GET /stream?token=<sseToken>
Backend does:  verifyToken(token, "sse")      → rejects access/refresh tokens
               consumeSseToken(jti)            → atomic get+del, single-use
               userId from the consumed mapping ← bound to user at issue time
               clients.set(userId, res)         ← userId from token only
```

A user can only ever receive their own notifications — even if they know
another user's ID, they cannot subscribe to that user's stream because the
userId is always derived from the verified, single-use token binding, never
from the URL.

### Connection flow

```
Frontend (useNotifications)       Backend
   |                                  |
   |── GET /stream?token=<sseToken> ->│── verifyToken(token, "sse")
   |                                  |── consumeSseToken(jti)  (single-use)
   |                                  |── userId from consumed binding
   |                                  |── clients.set(userId, res)
   |                                  |── audit log SSE_CONNECTED
   |<── EventStream ─────────────────|
   |                                  |
   |  onmessage                       |
   |<── { type, ...notification } ───|── sendNotificationToUser(userId, data)
   |                                  |
   |── (disconnect) ─────────────────|── clients.delete(userId)
   |                                  |── audit log SSE_DISCONNECTED
```

### Connection management

```ts
const clients = new Map<string, Set<Response>>();
```

- Heartbeat sent every 25s: `: heartbeat <timestamp>`
- On `close` or `error`: heartbeat cleared, client removed from set
- **5 connections per userId** — new connections replace oldest when limit exceeded
- Each user gets a `Set<Response>` allowing multiple simultaneous connections (mobile + desktop + tabs)

### React integration

SSE is managed inside the `useNotifications` hook. The hook handles everything: fetching notifications, real-time updates via SSE, and all mutations.

```ts
const {
  notifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
  isLoading,
  fetchNextPage,
  hasNextPage,
} = useNotifications();
```

**SSE behavior inside `useNotifications`:**
- Effect depends on `backendToken` — reconnects automatically when token rotates after silent refresh
- On new notification: prepends to React Query infinite cache, bumps unread count optimistically without a refetch
- Auto-reconnects after 5 seconds on disconnect
- Cancels and closes the connection cleanly on unmount
- No polling (`refetchInterval` removed) — SSE handles all real-time updates

### Axios integration

The `useNotifications` hook uses the shared `api` wrapper from `@/lib/axios`. The wrapper returns `ApiResponse<T>` which is `{ success, data?, message? }`, so queries unwrap one level:

```ts
// api.get<NotificationsResponse>() returns ApiResponse<NotificationsResponse>
const response = await api.get<NotificationsResponse>("/api/v1/notifications");
return response?.data ?? EMPTY_PAGE;  // .data is NotificationsResponse
```

### Sending notifications (backend)

All notification sending goes through `notifyUser()` in `notification.helpers.ts`, which writes to DB via `NotificationMutation.create()` and immediately pushes to the user's SSE stream:

```ts
import { notifyUser, notifyTaskAssignees, notifyWorkspaceMembers, notifyMentions } from "../utils/notification.helpers.js";

// Single user
await notifyUser({ userId, type: "TASK_ASSIGNED", title: "...", message: "..." });

// All task assignees (skips sender, skips users with notifications off)
await notifyTaskAssignees({ taskId, senderId: req.user.id, type: "TASK_UPDATED", title: "...", message: "...", excludeUserId: req.user.id });

// All workspace members
await notifyWorkspaceMembers({ workspaceId, senderId: req.user.id, type: "WORKSPACE_UPDATE", title: "...", message: "...", actionUrl: "..." });

// @mentions in text
await notifyMentions({ text: comment.content, workspaceId, senderId: req.user.id, senderName: req.user.name, context: "a comment", actionUrl: "..." });
```

---

## Logout

### Single device

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>   (optional — logout succeeds even if expired)

{ "logoutAll": false }
```

- Revokes current access token JTI in Redis (900s TTL)
- NextAuth session cookie destroyed by `signOut()`

### All devices

```json
{ "logoutAll": true }
```

- Revokes current access token JTI
- Calls `revokeAllRefreshTokens(userId)` — revokes all refresh tokens for the user using a per-user refresh index (with legacy key-scan fallback)
- Every other session will fail to refresh and naturally expire

**Note:** The `/logout` backend route does **not** use `authenticate` middleware. The token may already be expired at logout time — the route attempts to parse it for revocation but never blocks on it.

---

## Internal Backend-to-Backend Endpoints

Mounted at `/api/v1/internal` and authenticated with either a short-lived HMAC
proof signed with `NEXTAUTH_SECRET` (the Next.js server — same scheme as
`/exchange`, no extra env vars) or the optional `INTERNAL_AUTH_SECRET` header.

| Endpoint | Purpose |
|----------|---------|
| `POST /failed-attempt` | Record a failed login (returns `locked`/`unlocksAt`); audits `ACCOUNT_LOCKED` on the lock transition |
| `POST /clear-attempts` | Clear the failure counter + lock on successful login |
| `POST /audit` | Emit login audit events (`LOGIN_SUCCESS`/`LOGIN_FAILED`/`LOGIN_BLOCKED`) — whitelisted only |
| `POST /revoke-sessions` | Revoke ALL sessions + refresh tokens for a user (password reset) |

---

## Session Binding & Hijack Detection

Each session is bound to a device fingerprint (normalized browser family + OS + language) and an IP address. Every authenticated request checks these signals; a change is either a legitimate re-bind (`SESSION_REBOUND`) or a hijack (`SESSION_HIJACK_DETECTED`, which revokes all refresh tokens).

**Redis key:** `session:metadata:<sessionId>`
**TTL:** 7 days (matches refresh token lifetime)

The token exchange runs server-to-server (NextAuth), so the binding is left pending (`deviceId: null`) and adopted from the first real browser request — never rejected as a mismatch. Same-IP device changes (DevTools emulation, browser updates) silently re-bind; only a device change from a different IP is treated as a hijack. IP changes within 5 minutes of last activity are flagged as suspicious; after 5 minutes they are allowed.

### Account Lockout

After **10 failed login attempts**, the account is locked for **15 minutes**. The
Next.js credentials flow records failures and clears them on success via the
internal endpoints (`POST /api/v1/internal/failed-attempt` and
`/clear-attempts`, HMAC-signed with `NEXTAUTH_SECRET`); a locked account
receives a "temporarily locked" message on the login page. Audit events:
`ACCOUNT_LOCKED` (critical, emitted on the lock transition), `LOGIN_FAILED`,
`LOGIN_BLOCKED`, `LOGIN_SUCCESS`.

| Parameter | Value |
|-----------|-------|
| Max failed attempts | 10 |
| Lockout duration | 15 minutes |
| Failure-count window | 60 minutes |

**Redis keys:**
- `focura:lockout:failures:<email>` — incrementing failure counter (60-min window)
- `focura:lockout:locked:<email>` — lock flag (15-min TTL)

### Concurrent Session Management

Each user is limited to **5 active sessions**. On the 6th login, the least-active session is evicted and tombstoned.

- Tracked via `user:sessions:<userId>` (Redis set) plus `session:metadata:<sessionId>`
- The evicted session's tokens can no longer authenticate or refresh (`focura:session:revoked:<sessionId>` tombstone)

### Session Revocation on Credential Changes

- `PUT /api/v1/user/password` (change password) revokes **every other session** immediately — the current session stays logged in.
- A password reset (Next.js `POST /api/auth/reset-password`) calls `POST /api/v1/internal/revoke-sessions` to revoke **all** sessions and refresh tokens.

### Distributed Refresh Lock

A Redis-based lock prevents duplicate refresh token rotation across multiple backend instances.

**Redis key:** `focura:refresh:lock:<sessionId>`
**TTL:** 10 seconds

If a refresh request arrives while another is in-flight for the same session, the second request waits for the first to complete and reuses its result.

---

## CSRF Protection

All state-changing requests (POST, PUT, PATCH, DELETE) require a CSRF token in the `X-CSRF-Token` header.

```
GET /api/v1/csrf-token → { csrfToken: "random-32-byte-hex" }
```

The token is generated per-session, stored in Redis (`focura:csrf:<sessionId>`, 30-min TTL), and verified via timing-safe comparison.

---

## Session Timeout

Two timeout mechanisms enforced by `sessionTimeout.ts` middleware:

| Type | Duration | Behavior |
|------|----------|----------|
| Inactivity timeout | 7 days (`SESSION_INACTIVITY_TIMEOUT`, env-overridable) | Clears session on idle |
| Absolute timeout | 7 days (`SESSION_ABSOLUTE_TIMEOUT`) | Forces re-login regardless of activity |

**Redis keys:** `session:created:<sessionId>` and `session:activity:<sessionId>` (both 7-day TTL)

Updated on each authenticated request (and by the `/api/v1/auth/activity` heartbeat). If the inactivity gap exceeds the timeout, the session is rejected with `SESSION_TIMEOUT`.

---

## Security Headers

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `0` (modern browsers rely on CSP) |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; ...` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-DNS-Prefetch-Control` | `off` |

---

## RBAC (Role-Based Access Control)

5 roles with 18 granular permissions:

| Permission | OWNER | ADMIN | MANAGER | MEMBER | GUEST |
|------------|:-----:|:-----:|:-------:|:------:|:-----:|
| workspace.create | ✅ | | | | |
| workspace.update | ✅ | ✅ | | | |
| workspace.delete | ✅ | | | | |
| member.invite | ✅ | ✅ | | | |
| member.remove | ✅ | ✅ | | | |
| member.role.update | ✅ | ✅ | | | |
| project.create | ✅ | ✅ | ✅ | | |
| project.update | ✅ | ✅ | ✅ | | |
| project.delete | ✅ | ✅ | | | |
| task.create | ✅ | ✅ | ✅ | ✅ | |
| task.update | ✅ | ✅ | ✅ | ✅ | |
| task.delete | ✅ | ✅ | ✅ | | |
| comment.create | ✅ | ✅ | ✅ | ✅ | ✅ |
| comment.delete | ✅ | ✅ | ✅ | ✅ | |
| notification.manage | ✅ | ✅ | ✅ | ✅ | ✅ |
| billing.manage | ✅ | | | | |
| settings.manage | ✅ | ✅ | | | |
| audit.view | ✅ | ✅ | | | |

---

## Rate Limiting

### Login rate limiting (frontend)

Sliding-window, applied at the Next.js route handler before NextAuth processes the request.

| Limit       | Value                         |
|-------------|-------------------------------|
| Window      | 60 seconds                    |
| Max attempts| 5 per IP + email combination  |
| Backend     | Redis (prod) / in-memory (dev)|

### API rate limiting (backend)

Per-user, applied via `rateLimitByUser()` middleware.

| Tier       | Requests / minute |
|------------|-------------------|
| free       | 60                |
| pro        | 300               |
| enterprise | 1000              |

```ts
// Usage
router.post("/ai/generate", authenticate, rateLimitByUser("pro"), handler);
```

Rate limit headers returned on every response:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## Audit Logging

Every security-relevant event is emitted as structured JSON to stdout.

```json
{
  "event":     "TOKEN_REPLAY_DETECTED",
  "severity":  "critical",
  "timestamp": "2026-02-25T10:35:16.529Z",
  "userId":    "cml4r530o0003nx5ed6dta9kl",
  "jti":       "8cdc6060-eba5-4a1a-8225-36fafd723025",
  "ip":        "::1",
  "reason":    "Refresh token already used or revoked"
}
```

| Event                    | Severity |
|--------------------------|----------|
| `LOGIN_SUCCESS`          | info     |
| `LOGIN_FAILED`           | warn     |
| `LOGIN_BLOCKED`          | warn     |
| `LOGOUT`                 | info     |
| `LOGOUT_ALL_DEVICES`     | info     |
| `TOKEN_REFRESHED`        | info     |
| `TOKEN_REVOKED`          | info     |
| `TOKEN_EXPIRED`          | info     |
| `TOKEN_VERSION_MISMATCH` | warn     |
| `TOKEN_REPLAY_DETECTED`  | critical |
| `EXCHANGE_SUCCESS`       | info     |
| `EXCHANGE_FAILED`        | warn     |
| `SSE_CONNECTED`          | info     |
| `SSE_DISCONNECTED`       | info     |
| `PERMISSION_DENIED`      | warn     |
| `EMAIL_NOT_VERIFIED`     | warn     |
| `SESSION_BINDING_MISMATCH` | critical |
| `SESSION_EXPIRED_INACTIVITY` | info  |
| `SESSION_EXPIRED_ABSOLUTE` | info    |
| `ACCOUNT_LOCKED`         | warn     |
| `ACCOUNT_LOCKOUT_CLEARED` | info    |
| `CSRF_VALIDATION_FAILED` | warn     |
| `RATE_LIMIT_EXCEEDED`    | warn     |
| `Hijack_DETECTED`        | critical |
| `SESSION_LIMIT_EXCEEDED` | warn     |
| `WORKSPACE_CREATED`      | info     |
| `WORKSPACE_UPDATED`      | info     |
| `WORKSPACE_DELETED`      | info     |
| `MEMBER_INVITED`         | info     |
| `MEMBER_REMOVED`         | info     |
| `MEMBER_ROLE_CHANGED`    | info     |
| `TASK_CREATED`           | info     |
| `TASK_UPDATED`           | info     |
| `TASK_DELETED`           | info     |
| `COMMENT_CREATED`        | info     |
| `COMMENT_DELETED`        | info     |
| `FILE_UPLOADED`          | info     |
| `FILE_DELETED`           | info     |
| `BILLING_SUBSCRIPTION_CREATED` | info |
| `BILLING_SUBSCRIPTION_UPDATED` | info |
| `BILLING_SUBSCRIPTION_CANCELLED` | info |
| `BILLING_INVOICE_PAID`   | info     |
| `AI_REQUEST`             | info     |
| `EXPORT_REQUESTED`       | info     |
| `PASSWORD_CHANGED`       | info     |
| `PASSWORD_RESET_REQUESTED` | info   |

In production, pipe stdout to your SIEM (Datadog, CloudWatch, Splunk).

---

## Redis Key Schema

All keys are prefixed with `focura:` to avoid collisions.

| Key pattern                        | TTL       | Purpose                        |
|------------------------------------|-----------|--------------------------------|
| `focura:revoked:access:<jti>`      | 900s      | Revoked access token JTIs      |
| `focura:refresh:<userId>:<jti>`    | 7 days    | Valid refresh token JTIs       |
| `focura:refresh:index:<userId>`    | no TTL*   | Set of refresh-token keys per user for fast revoke-all |
| `focura:refresh:result:<userId>:<oldJti>` | 30s | Cached refresh response for idempotent duplicate refresh handling |
| `focura:refresh:lock:<sessionId>`  | 45s       | Distributed lock for refresh rotation |
| `focura:rl:<key>`                  | 60s       | Rate limiting sliding window   |
| `session:metadata:<sessionId>`     | 7 days    | Device + IP fingerprint + last activity |
| `session:created:<sessionId>`      | 7 days    | Absolute session lifetime marker |
| `session:activity:<sessionId>`     | 7 days    | Inactivity tracking              |
| `focura:session:revoked:<sessionId>` | 7 days | Tombstone for evicted/revoked sessions |
| `focura:lockout:failures:<email>`  | 60 min    | Failed login attempt counter     |
| `focura:lockout:locked:<email>`    | 15 min    | Account lockout flag             |
| `focura:csrf:<sessionId>`          | 30 min    | CSRF token per session         |
| `focura:sse:<jti>`                 | 30s       | Single-use SSE token binding   |
| `focura:db:pool:metrics`           | 10s       | Database connection pool stats |

\* Index members are updated on token store/rotate/revoke; key is removed on revoke-all.

---

## Environment Variables

### Frontend (Next.js)

```env
NEXTAUTH_SECRET=          # Must match backend — used for HMAC exchange proof
NEXTAUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BACKEND_URL=              # Server-side only (no NEXT_PUBLIC)
NEXT_PUBLIC_API_URL=      # Client-side, for SSE connection
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NODE_OPTIONS=--dns-result-order=ipv4first
```

### Backend (Express)

```env
NEXTAUTH_SECRET=          # Must match frontend — used to verify HMAC exchange proof
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
# Production (base64 encoded):
# JWT_PRIVATE_KEY=
# JWT_PUBLIC_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ALLOWED_ORIGIN=http://localhost:3000
REDIS_URL=                        # ioredis — sessions, revocation, CSRF, lockout
TRUST_PROXY_HOPS=1                # reverse-proxy hops for req.ip (Railway: 1; 0 disables)
INTERNAL_AUTH_SECRET=             # optional shared secret for /api/v1/internal tooling
SESSION_INACTIVITY_TIMEOUT=604800 # seconds (default 7 days)
SESSION_ABSOLUTE_TIMEOUT=604800   # seconds (default 7 days)
```

---

## Protecting Routes

### Express middleware

```ts
import { authenticate, authorize, rateLimitByUser } from "../middleware/auth.js";

// Any authenticated user
router.get("/profile", authenticate, handler);

// Role-based access
router.delete("/user/:id", authenticate, authorize("ADMIN"), handler);

// With rate limiting
router.post("/ai/generate", authenticate, rateLimitByUser("pro"), handler);
```

### Notification routes (special case)

The SSE stream route sits outside the `authenticate` middleware block because it handles its own token verification internally. All other notification routes are protected normally:

```ts
// SSE — token verified inside notificationStream(), no userId in URL
router.get("/stream", notificationStream);

// All routes below this line require authenticate middleware
router.use(authenticate);
router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.delete("/read/all", deleteAllRead);  // must be before /:id
router.delete("/:id", deleteNotification);
```

### Next.js server component

```ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";

const session = await getServerSession(authOptions);

const res = await fetch(`${process.env.BACKEND_URL}/api/data`, {
  headers: { Authorization: `Bearer ${session?.backendToken}` },
});
```

---

## Key Rotation

To rotate RSA keys (e.g. every 90 days or after a breach):

1. Run `node scripts/generate-keys.js` in the backend
2. Increment `CURRENT_TOKEN_VERSION` in `backendToken.ts`
3. Deploy frontend first (issues new tokens with new version)
4. Deploy backend (starts rejecting old version tokens)
5. All users are prompted to re-authenticate — expected behavior

---

## Security Properties Summary

| Property                        | Implementation                              |
|---------------------------------|---------------------------------------------|
| Asymmetric signing              | RS256 — backend signs, anyone can verify    |
| Private key isolation           | Lives only in Express backend               |
| Token revocation                | Redis JTI blocklist for access tokens       |
| Refresh token rotation          | Single-use JTIs, replay detection           |
| Global invalidation             | `CURRENT_TOKEN_VERSION` increment           |
| Timing attack protection        | `crypto.timingSafeEqual` + argon2 dummy hash|
| Password hashing                | Argon2id                                    |
| Login rate limiting             | Sliding-window, IP + email composite key    |
| API rate limiting               | Per-user, subscription tier aware           |
| Audit trail                     | Structured JSON, severity-tagged            |
| Session management              | HTTP-only cookie via NextAuth               |
| Session binding                 | IP + User-Agent fingerprint via Redis       |
| Account lockout                 | 10 failed attempts → 15-min lock (wired via internal endpoints) |
| Concurrent session limit        | 5 sessions per user, oldest revoked         |
| Distributed refresh lock        | Redis lock prevents duplicate rotation      |
| CSRF protection                 | Per-session token, timing-safe verification |
| Security headers                | CSP, HSTS, X-Frame-Options, etc.            |
| RBAC                            | 5 roles, 18 granular permissions            |
| Session timeouts                | 7-day inactivity, 7-day absolute             |
| SSE security                    | 30s single-use token, atomic consume, 5 conns/user max |

---
**Last Updated**: August 13, 2026