# ⚙️ Focura Backend

Focura Backend is the **core API and business logic layer** powering the Focura productivity SaaS.
It is responsible for authentication, workspaces, projects, tasks, comments, notifications, analytics, and real-time communication.

Built with a **modular monolith architecture** — each domain is fully self-contained with its own routes, controllers, queries, mutations, types, and selects, while sharing a single Express server and Prisma instance.

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma (primary + read replica) |
| Auth | NextAuth-compatible RS256 JWT |
| Real-time | Server-Sent Events (SSE) + Redis pub/sub |
| Caching | Upstash Redis (REST) — analytics, workspace, labels, storage |
| Pub/Sub | ioredis (TCP) — SSE fan-out across instances |
| Rate Limiting | Sliding-window (Redis + in-memory fallback) |
| CSRF Protection | Double-submit cookie pattern (ioredis-backed) |
| Job Scheduling | node-cron |

---

## 🧠 Core Responsibilities

- User authentication, token issuance, and session management
- RS256 JWT signing — private key lives only in this backend
- Workspace isolation and role-based access control
- Task, project, label, and team management
- Daily tasks and focus session tracking
- Calendar and scheduling logic
- File, attachment, and storage management
- Activity feed and audit trail
- Real-time notifications via SSE + Redis pub/sub
- Task analytics and statistics
- Comment threads and @mention notifications
- Audit logging for all security-relevant events
- Business rule enforcement and input validation
- Response caching for read-heavy analytics and workspace queries

---

## 📁 Folder Structure

```txt
src/
├── index.ts                    # App entry point, Express setup, route registration
│
├── middleware/
│   ├── auth.ts                 # authenticate, authorize, rateLimitByUser
│   ├── csrf.ts                 # requireCsrfToken, getCsrfTokenHandler
│   ├── securityHeaders.ts      # CSP, HSTS, X-Frame-Options, Permissions-Policy
│   └── errorHandler.ts         # Global error handler
│
├── modules/                    # Self-contained domain modules
│   ├── activity/
│   ├── analytics/
│   ├── attachment/
│   ├── calendar/
│   ├── comment/
│   ├── dailyTask/
│   ├── fileManagement/
│   ├── focusSession/
│   ├── label/
│   ├── notification/
│   │   ├── notification.controller.ts
│   │   ├── notification.helpers.ts  # notifyUser, notifyTaskAssignees, etc.
│   │   ├── notification.mutation.ts
│   │   ├── notification.query.ts    # prismaRead for list, prisma for count
│   │   ├── notification.routes.ts
│   │   ├── notification.selects.ts
│   │   ├── notification.types.ts
│   │   └── index.ts
│   ├── project/
│   ├── storage/
│   ├── task/
│   ├── upload/
│   └── workspace/
│       └── workspace.notifications.ts
│
├── sockets/
│   └── notification.stream.ts  # SSE handler — Redis sub → local fan-out
│
├── lib/
│   ├── prisma.ts               # Exports prisma (primary) + prismaRead (replica)
│   ├── auth/
│   │   ├── backendToken.ts     # RS256 signing, verification, token creation
│   │   ├── tokenRevocation.ts  # Redis JTI revocation
│   │   ├── auditLog.ts         # Structured security event logging
│   │   └── sessionBinding.ts   # IP/UA session binding validation
│   ├── cache/
│   │   └── cache.client.ts     # CacheClient, CACHE_KEYS, CACHE_TTL,
│   │                           # WorkspaceCache, LabelCache, AnalyticsCache,
│   │                           # StorageCache invalidation helpers
│   ├── redis/
│   │   └── redis.client.ts     # Upstash ioredis client (caching, rate limiting)
│   └── sse/
│       └── sse.channels.ts     # userChannel(), SSEPayload, NotificationPayload
│
├── redis/
│   └── redis.pubsub.ts         # getPublisher() + getSubscriber() (ioredis TCP)
│
├── crons/
│   └── notification.cron.ts    # Task reminders, cleanup jobs
│
├── keys/
│   ├── private.pem             # RSA private key — NEVER commit
│   └── public.pem              # RSA public key
│
└── scripts/
    └── generate-keys.js        # One-time RSA key pair generator
```

---

## 🏗️ Modular Monolith Pattern

Each domain module is fully self-contained:

```
modules/<domain>/
├── <domain>.routes.ts       # Route registration only
├── <domain>.controller.ts   # Request/response handling, thin layer
├── <domain>.query.ts        # All read operations (Prisma SELECT)
├── <domain>.mutation.ts     # All write operations (Prisma CREATE/UPDATE/DELETE)
├── <domain>.selects.ts      # Reusable Prisma select/include objects
├── <domain>.types.ts        # TypeScript types and interfaces
└── index.ts                 # Module barrel export
```

Some modules include additional files:

| Extra File | Purpose | Modules |
|---|---|---|
| `<domain>.access.ts` | Permission/access checks | activity, analytics, attachment, comment, dailyTask, fileManagement, label, project, storage, task, workspace |
| `<domain>.activity.ts` | Activity feed logging | comment, dailyTask, task, workspace |
| `<domain>.validators.ts` | Input validation | attachment, calendar, comment, dailyTask, focusSession, label, project, storage, task, workspace |
| `<domain>.notifications.ts` | Notification dispatch | task, workspace |
| `<domain>.filters.ts` | Query filtering logic | fileManagement, task |
| `<domain>.analytics.ts` | Analytics/stats logic | activity, focusSession |
| `<domain>.cron.ts` | Scheduled jobs | dailyTask |

**Rules:**
- Controllers are thin — they call queries/mutations, never write Prisma directly
- Queries use `prismaRead` for read-heavy paths; mutations always use `prisma` (primary)
- Cross-module notification dispatch goes through `modules/notification/notification.helpers.ts`
- Cache invalidation is called from mutations via `lib/cache/cache.client.ts` helpers
- All modules share one Prisma instance exported from `lib/prisma.ts`

---

## 🔐 Authentication & Security

See [AUTHENTICATION.md](./AUTHENTICATION.md) for the full architecture.

**Summary:**
- RS256 asymmetric JWT — private key never leaves this server
- NextAuth exchanges a HMAC-signed proof for an RS256 token pair via `POST /api/auth/exchange`
- Access tokens: 15 min, refresh tokens: 7 days with rotation
- Refresh token JTIs tracked in Redis — replay attacks detected and logged
- Token version field allows global invalidation by incrementing `CURRENT_TOKEN_VERSION`
- Session binding: IP + User-Agent validated on every request; hijack detected → all tokens revoked
- All security events emitted as structured JSON audit logs
- Login rate limiting: 5 attempts/min per IP+email
- API rate limiting: per-user tier (free: 60/min, pro: 300/min, enterprise: 1000/min)

---

## 🛡️ CSRF Protection

All mutating routes (`POST`, `PATCH`, `PUT`, `DELETE`) require a valid CSRF token via the `requireCsrfToken()` middleware.

**Flow:**
1. Authenticated client calls `GET /api/csrf-token` → receives a signed token stored in ioredis
2. Client attaches it as `X-CSRF-Token` header on every mutating request
3. `requireCsrfToken()` validates the token against Redis; invalid or missing → `403 CSRF_VALIDATION_FAILED`
4. On CSRF failure the frontend automatically refreshes the token and retries once

**Routes exempt from CSRF:**
- `GET` requests (read-only)
- `/api/notifications/stream` (SSE — EventSource API cannot send custom headers)
- `/api/auth/*` (handles its own token exchange flow)
- `/api/contact`, `/api/jobs`, `/api/templates` (public endpoints)
- Stripe webhook (`/webhooks/stripe`) — verified via Stripe signature instead

---

## 🔒 Security Headers

Every response carries a full set of security headers via `securityHeaders` middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'` + per-directive rules | Restricts resource origins |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer leakage |
| `Permissions-Policy` | camera, mic, geo, payment all `()` | Disables sensitive browser APIs |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Forces HTTPS (production only) |
| `Cross-Origin-Embedder-Policy` | `require-corp` | Isolates cross-origin resources |
| `Cross-Origin-Opener-Policy` | `same-origin` | Prevents cross-origin window access |
| `Cross-Origin-Resource-Policy` | `same-origin` | Blocks cross-origin reads |

Helmet is also applied on top for additional defaults, with a stricter CSP in production.

---

## 📡 Real-Time Notifications (SSE + Redis Pub/Sub)

```
Client → GET /api/notifications/stream?token=<accessToken>
Backend → verifyToken() → extract userId
       → await SUBSCRIBE sse:user:<userId> (Redis confirmed)
       → write "connected" handshake
       → keep connection open
```

**Why pub/sub instead of in-memory Map:**
- Works across multiple backend instances — any instance can PUBLISH, every instance with that user's connection delivers it
- Notifications are durable in Postgres — Redis failure never loses data
- One Redis SUBSCRIBE per unique userId per process regardless of tab count

**Two ioredis clients (separate TCP connections):**

| Client | Purpose |
|--------|---------|
| `getPublisher()` | Sends PUBLISH — stays in normal mode |
| `getSubscriber()` | Dedicated SUBSCRIBE/UNSUBSCRIBE — a subscribed client cannot send PUBLISH |

**Subscribe is awaited before the "connected" handshake** — guarantees no PUBLISH can be missed between the browser connecting and the first user action.

**Notification dispatch helpers** (all in `modules/notification/notification.helpers.ts`):

```ts
// Single user
await notifyUser({ userId, type, title, message, actionUrl });

// All task assignees
await notifyTaskAssignees({ taskId, senderId, type, title, message, excludeUserId });

// All workspace members
await notifyWorkspaceMembers({ workspaceId, senderId, type, title, message });

// @mentions parsed from text
await notifyMentions({ text, workspaceId, senderId, senderName, context, actionUrl });
```

Each call writes to Postgres first (durable), then PUBLISHes to Redis. A Redis failure is logged but never propagates — the notification is always persisted.

---

## 🗄️ DB Connection Pooling

Two Prisma clients with separate connection pools:

| Client | Pool | Used for |
|--------|------|---------|
| `prisma` | `connection_limit=5` | All mutations, unread count badge, consistency-critical reads |
| `prismaRead` | `connection_limit=10` | Notification list, analytics, activity feeds, calendar aggregates, storage stats |

`prismaRead` falls back to `DATABASE_URL` if `READ_DATABASE_URL` is not set — safe to deploy without a replica.

Connection limit formula: `connection_limit ≤ (max_connections − 3) / num_instances`

---

## ⚡ Response Caching

Read-heavy endpoints are cached in Upstash Redis (REST) via `CacheClient` in `lib/cache/cache.client.ts`.

**Cached resources and TTLs:**

| Resource | TTL | Invalidated by |
|----------|-----|----------------|
| Workspace metadata | 1 hour | Workspace update/delete |
| Workspace overview | 1 hour | Workspace update |
| Workspace members | 1 hour | Member join/leave/role change |
| User workspaces list | 1 hour | Workspace create/delete |
| Label list | 30 min | Label create/update/delete |
| Analytics dashboard | 1 hour | Task/project mutations |
| Analytics KPIs | 1 hour | Task/project mutations |
| Analytics task trends | 1 hour | Task status changes |
| Storage overview | 1 min | File upload/delete |
| Storage info | 1 min | File upload/delete |
| Storage largest files | 2 min | File upload/delete |
| Storage user contributions | 2 min | File upload/delete |

**Cache invalidation helpers:**
```ts
await WorkspaceCache.invalidateWorkspace(workspaceId, slug);
await WorkspaceCache.invalidateUserWorkspaces(userId);
await LabelCache.invalidateLabelList(userId, workspaceId);
await AnalyticsCache.invalidateWorkspace(workspaceId);
await StorageCache.invalidateAll(workspaceId, userId);
```

`CacheClient.getOrSet(key, fetcher, ttl)` is the standard pattern — fetches from cache, falls back to DB, repopulates automatically.

---

## 🔄 Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Task reminder | Every 5 minutes | Notifies assignees 6h, 3h, 30m before due date |
| Overdue alerts | Every 5 minutes | Notifies assignees 1h, 6h, 24h after due date |
| Notification cleanup | Daily at 3 AM | Deletes read notifications older than 30 days |
| Daily task reset | Scheduled | Handled via `dailyTask.cron.ts` |

Redis dedup keys (`notif:sent:<taskId>:<userId>:<type>:<label>`) prevent double-firing across cron runs. TTL is set to 25 hours.

---

## 🛡️ Role-Based Access Control

| Role | Scope |
|------|-------|
| `OWNER` | Full workspace control, billing, deletion |
| `ADMIN` | Member management, project creation |
| `MEMBER` | Task and project access within workspace |

```ts
router.delete("/workspace/:id", authenticate, authorize("OWNER"), handler);
```

---

## 🛠️ Environment Variables

```env
# Server
NODE_ENV=development
PORT=5000
ALLOWED_ORIGIN=http://localhost:3000
CLIENT_URL=http://localhost:3000

# Database (primary)
DATABASE_URL=postgresql://...

# Database (read replica — optional, falls back to DATABASE_URL)
READ_DATABASE_URL=postgresql://...readonly...

# Auth — private key lives ONLY here, never in the frontend
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
# Production (base64 encoded):
# JWT_PRIVATE_KEY=
# JWT_PUBLIC_KEY=

# Must match frontend NEXTAUTH_SECRET — used to verify HMAC exchange proof
NEXTAUTH_SECRET=

# Upstash Redis REST — caching, rate limiting, token revocation, CSRF tokens
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ioredis TCP — Redis pub/sub for SSE fan-out
# Use the Upstash TCP endpoint: rediss://default:<password>@<host>:6380
REDIS_URL=rediss://...
```

---

## 🧪 Local Development

### 1. Generate RSA keys (first time only)

```bash
node scripts/generate-keys.js
```

Creates `keys/private.pem` and `keys/public.pem`. The private key is gitignored automatically.

### 2. Install dependencies

```bash
npm install
```

### 3. Setup database

```bash
npx prisma migrate dev
npx prisma generate
```

### 4. Run the server

```bash
npm run dev
```

Server runs on `http://localhost:5000`.

---

## 📡 API Overview

**Base URL:** `/api`

| Method | Route | Auth | CSRF | Description |
|--------|-------|------|------|-------------|
| `POST` | `/api/auth/exchange` | — | — | Issue RS256 tokens after NextAuth login |
| `POST` | `/api/auth/refresh` | — | — | Rotate refresh token |
| `POST` | `/api/auth/logout` | ✓ | — | Revoke tokens |
| `GET` | `/api/csrf-token` | ✓ | — | Get CSRF token for session |
| `GET` | `/api/notifications/stream` | query token | — | SSE stream (Redis pub/sub backed) |
| `GET` | `/api/notifications` | ✓ | — | Paginated list (read replica) |
| `GET` | `/api/notifications/unread-count` | ✓ | — | Badge count (primary DB) |
| `PATCH` | `/api/notifications/:id/read` | ✓ | ✓ | Mark as read |
| `PATCH` | `/api/notifications/read-all` | ✓ | ✓ | Mark all as read |
| `DELETE` | `/api/notifications/:id` | ✓ | ✓ | Delete notification |
| `DELETE` | `/api/notifications/read/all` | ✓ | ✓ | Delete all read |
| `GET` | `/api/workspaces` | ✓ | — | List user workspaces (cached) |
| `POST` | `/api/workspaces` | ✓ | ✓ | Create workspace |
| `PATCH` | `/api/workspaces/:id` | ✓ | ✓ | Update workspace |
| `DELETE` | `/api/workspaces/:id` | ✓ | ✓ | Delete workspace |
| `GET` | `/api/workspace-usage/:workspaceId` | ✓ | — | Usage dashboard (cached) |
| `POST` | `/api/projects` | ✓ | ✓ | Create project |
| `GET` | `/api/tasks` | ✓ | — | List tasks |
| `GET` | `/api/tasks/stats` | ✓ | — | Task analytics (cached) |
| `PATCH` | `/api/tasks/:id/status` | ✓ | ✓ | Update task status |
| `POST` | `/api/tasks/:id/comments` | ✓ | ✓ | Add comment |
| `GET` | `/api/analytics` | ✓ | — | Workspace analytics (cached) |
| `GET` | `/api/storage` | ✓ | — | Storage usage (cached) |
| `POST` | `/api/upload` | ✓ | ✓ | File upload |
| `GET` | `/api/admin/stats` | ✓ admin | ✓ | Platform-wide metrics |
| `GET` | `/health` | — | — | Health check |

All authenticated routes require `Authorization: Bearer <accessToken>`.
All mutating authenticated routes additionally require `X-CSRF-Token`.

---

## 🧩 Database

- PostgreSQL via Prisma ORM
- Two connection pools: primary (writes + critical reads) and read replica (analytics, feeds, lists)
- Workspace-based data isolation — every query is scoped to a workspace
- Optimized indexes for task, notification, and activity queries
- Cursor-based pagination implemented per-module

---

## 🧱 Architecture Principles

- **Modular monolith** — domain modules are self-contained, deployed as one unit
- **Thin controllers** — request parsing and response shaping only
- **Query/mutation split** — reads and writes always separated; reads use replica where possible
- **Cache-aside pattern** — `CacheClient.getOrSet()` wraps every expensive read
- **Durable notifications** — DB write always happens before Redis PUBLISH; Redis failure never loses data
- **Defence in depth** — CSRF + security headers + rate limiting + session binding + RBAC
- **No hidden magic** — explicit imports, explicit middleware, explicit error handling

---

## 🚫 What This Backend Does NOT Do

- UI rendering or SSR
- Client-side state management
- JWT signing on the frontend (private key never leaves this server)
- SEO or static generation

---

## 🧪 Performance Benchmarking

```bash
npm run bench:api
```

Required env vars:

```env
BENCH_BASE_URL=http://localhost:5000/api
BENCH_ACCESS_TOKEN=<valid access token>
BENCH_WORKSPACE_ID=<workspace id>
BENCH_RUNS=20
BENCH_CONCURRENCY=1
```

Reports `avg`, `min`, `max`, `p95`, and `p99` latencies for workspace usage, storage, and analytics endpoints.

---

## 👤 Maintainer

**Mohammad Raihan Gazi**
Creator & Maintainer of Focura

---

## 📄 License

This project is currently private / source-available.
License details will be added in the future.