# ⚙️ Focura Backend

> **The core API and business logic layer powering the Focura productivity SaaS.**

Built with a **modular monolith architecture** — each domain is fully self-contained with its own routes, controllers, queries, mutations, types, and selects, while sharing a single Express server and Prisma instance.

**Deployment:** https://focura-backend-vr75.onrender.com

---

## 📋 Table of Contents

- [Tech Stack](#-tech-stack)
- [Core Responsibilities](#-core-responsibilities)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Authentication & Security](#authentication--security)
- [Database Schema](#database-schema)
- [API Reference](#-api-reference)
- [Real-Time Notifications](#-real-time-notifications)
- [Caching](#caching)
- [Payment Providers](#payment-providers)
- [Job Queue](#job-queue)
- [Cron Jobs](#cron-jobs)
- [Testing](#testing)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [License](#-license)

---

## 🚀 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20+ |
| Framework | Express.js | 5.1.0 |
| Language | TypeScript | 5.9.3 |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 5.22.0 |
| Auth | RS256 JWT (asymmetric) | jsonwebtoken 9.0.2 |
| Real-time | Server-Sent Events (SSE) + Redis pub/sub | ioredis 5.10.0 |
| Caching | Upstash Redis (REST) | @upstash/redis 1.36.2 |
| Rate Limiting | Sliding-window (Redis + in-memory fallback) | @upstash/ratelimit 2.0.8 |
| CSRF Protection | Double-submit cookie pattern (ioredis-backed) | - |
| Job Queue | BullMQ | 5.80.2 |
| Cron Jobs | node-cron | 4.2.1 |
| File Upload | Cloudinary | 2.8.0 |
| Payments | Stripe + Paddle | stripe 20.4.1, @paddle/paddle-node-sdk 3.8.0 |
| Password Hashing | Argon2 | 0.44.0 |
| Validation | Zod | 4.1.13 |
| Input Sanitization | DOMPurify + escape-html | isomorphic-dompurify 3.12.0 |
| Security Headers | Helmet | 8.1.0 |
| Error Tracking | Sentry | @sentry/node 10.62.0 |
| Email | Nodemailer | 7.0.11 |
| Testing | Vitest + Supertest + MSW | vitest 3.2.4 |
| Performance | autocannon | 8.0.0 |
| Tunneling | ngrok | @ngrok/ngrok 1.7.0 |

---

## 🧠 Core Responsibilities

- User authentication, token issuance, and session management
- RS256 JWT signing — private key lives only in this backend
- Workspace isolation and role-based access control
- Task, project, label, and team management
- Subtask hierarchy and task dependencies
- Daily task prioritization
- Focus/pomodoro session tracking
- Calendar intelligence, wellness monitoring, and burnout detection
- Energy level tracking and wellness recommendations
- File, attachment, and storage management with quota enforcement
- Meeting scheduling and attendee management
- Activity feed and audit trail
- Real-time notifications via SSE + Redis pub/sub
- Comment threads with @mention notifications
- Task analytics and statistics (workspace + project level)
- Billing and subscription management (Stripe + Paddle)
- Third-party integrations (GitHub, Slack, Google Calendar, Trello)
- Feature request voting system
- Contact form handling
- Job posting management
- CMS for popular resources and product updates
- Email notification queue
- Background job processing (BullMQ)
- **AI assistant (Google Gemini)** — server-side `src/modules/ai`: task autocomplete, goal breakdown, comment assist, with tier-based quota/rate limiting (see `GEMINI.md`)
- Audit logging for all security-relevant events
- Business rule enforcement and input validation
- Response caching for read-heavy analytics and workspace queries

---

## 🏗 Architecture

### Modular Monolith Pattern

Each domain module is fully self-contained:

```
src/modules/<domain>/
├── <domain>.routes.ts       # Route registration only
├── <domain>.controller.ts   # Request/response handling, thin layer
├── <domain>.query.ts        # All read operations (Prisma SELECT)
├── <domain>.mutation.ts     # All write operations (Prisma CREATE/UPDATE/DELETE)
├── <domain>.selects.ts      # Reusable Prisma select/include objects
├── <domain>.types.ts        # TypeScript types and interfaces
├── <domain>.access.ts       # Permission/access checks
├── <domain>.validators.ts   # Input validation (Zod schemas)
├── <domain>.activity.ts     # Activity feed logging
├── <domain>.notifications.ts # Notification dispatch
├── <domain>.filters.ts      # Query filtering logic
├── <domain>.analytics.ts    # Analytics/stats logic
├── <domain>.cron.ts         # Scheduled jobs
├── <domain>.service.ts      # Business logic (some modules)
├── <domain>.repository.ts   # Data access abstraction (some modules)
└── index.ts                 # Module barrel export
```

**Rules:**
- Controllers are thin — they call queries/mutations, never write Prisma directly
- Queries use `prismaRead` for read-heavy paths; mutations always use `prisma` (primary)
- Cross-module notification dispatch goes through `modules/notification/notification.helpers.ts`
- Cache invalidation is called from mutations via `lib/redis/cache.client.ts` helpers
- All modules share one Prisma instance exported from `lib/prisma.ts`

### Dual Prisma Client Architecture

Two Prisma clients with separate connection pools:

| Client | Pool | Used for |
|--------|------|---------|
| `prisma` | `connection_limit=5` | All mutations, unread count badge, consistency-critical reads |
| `prismaRead` | `connection_limit=10` | Notification list, analytics, activity feeds, calendar aggregates, storage stats |

`prismaRead` falls back to `DATABASE_URL` if `READ_DATABASE_URL` is not set — safe to deploy without a replica.

Connection limit formula: `connection_limit ≤ (max_connections − 3) / num_instances`

---

## 📁 Project Structure

```
src/
├── index.ts                    # App entry point, Express setup, route registration
├── app.ts                      # Express app factory (used by tests)
│
├── config/
│   └── admin.config.ts         # Focura admin IDs configuration
│
├── middleware/                  # 11 middleware files
│   ├── auth.ts                 # authenticate, authorize, rateLimitByUser
│   ├── csrf.ts                 # requireCsrfToken, getCsrfTokenHandler
│   ├── rbac.ts                 # Role-based access control (18 permissions, 5 roles)
│   ├── securityHeaders.ts      # CSP, HSTS, X-Frame-Options, Permissions-Policy
│   ├── sessionTimeout.ts       # 30-min inactivity, 7-day absolute timeout
│   ├── rateLimiter.ts          # IP-based rate limiting (Redis sorted sets)
│   ├── dbMonitoring.ts         # DB pool monitoring + guard at 95% utilization
│   ├── focuraAdmin.ts          # Focura admin middleware
│   ├── upload.ts               # Multer config (10MB, image/doc/zip)
│   ├── workspaceManage.ts      # Workspace access helpers
│   └── errorHandler.ts         # Legacy error handler (Prisma codes)
│
├── errors/                     # Centralized error handling
│   ├── AppError.ts             # Base error + 14 subclasses (400-429)
│   ├── asyncHandler.ts         # Async route handler wrapper
│   ├── errorHandler.ts         # Global error handler (Prisma + Sentry)
│   └── index.ts                # Barrel export
│
├── modules/                    # 26 self-contained domain modules
│   ├── activity/               # Activity feed/audit trail (9 files)
│   ├── analytics/              # Workspace/project analytics (7 files)
│   ├── announcement/           # Workspace/project announcements (8 files)
│   ├── apikey/                 # API key management (5 files)
│   ├── attachment/             # File attachments + quota (13 files)
│   ├── billing/                # Billing/subscriptions (8 files + config/)
│   ├── calendar/               # Calendar, wellness, energy (12 files)
│   ├── comment/                # Threaded comments + @mentions (11 files)
│   ├── contact/                # Contact form (8 files)
│   ├── dailyTask/              # Daily task prioritization (11 files)
│   ├── feature/                # Feature request/voting (7 files)
│   ├── file/                   # File management (9 files)
│   ├── focusSession/           # Focus/pomodoro sessions (9 files)
│   ├── integration/            # Third-party integrations (11 files)
│   ├── job/                    # Job postings (5 files)
│   ├── label/                  # Task labels/tags (10 files)
│   ├── meeting/                # Meeting scheduling (10 files)
│   ├── notification/           # In-app notifications + SSE (11 files)
│   ├── project/                # Project management (10 files)
│   ├── resource/               # CMS: resources + updates (8 files)
│   ├── storage/                # Storage analytics/management (9 files)
│   ├── task/                   # Task management (16 files + subtask/ 9 files)
│   ├── templates/              # Email/notification templates (2 files)
│   ├── upload/                 # File upload (2 files)
│   ├── workspace/              # Workspace CRUD + membership (12 files)
│   └── workspaceUsage/         # Workspace usage analytics (7 files)
│
├── admin/                      # Super-admin panel (8 files)
│   ├── admin.routes.ts         # 13 admin endpoints
│   ├── admin.controller.ts     # Request handlers
│   ├── admin.service.ts        # Business logic + guards
│   ├── admin.query.ts          # Read operations
│   ├── admin.mutation.ts       # Write operations
│   ├── admin.validation.ts     # Zod schemas
│   ├── admin.types.ts          # TypeScript interfaces
│   └── admin.email.ts          # Admin email functions
│
├── controllers/
│   └── user.controller.ts      # User profile CRUD + password change
│
├── routes/
│   ├── auth.routes.ts          # Token exchange, refresh, logout
│   ├── user.routes.ts          # Profile, password, workspace members
│   ├── internal.routes.ts      # Internal API (account lockout)
│   └── subscribe.routes.ts     # Email subscription
│
├── lib/
│   ├── prisma.ts               # Primary + read replica Prisma clients (247 lines)
│   ├── sentry.ts               # Sentry error tracking
│   ├── redis.ts                # Upstash Redis client
│   ├── rateLimit.ts            # Upstash rate limiter
│   ├── limiter.ts              # Tiered per-user rate limiting
│   ├── auth/
│   │   ├── backendToken.ts     # RS256 JWT creation/verification
│   │   ├── tokenRevocation.ts  # Redis JTI revocation + rotation
│   │   ├── sessionBinding.ts   # Device fingerprinting + hijack detection
│   │   ├── sessionManager.ts   # Concurrent session tracking (max 5)
│   │   ├── refreshLock.ts      # Distributed lock for refresh rotation
│   │   ├── accountLockout.ts   # 10 failures -> 15-min lockout
│   │   └── auditLog.ts         # 40+ structured security event types
│   ├── redis/
│   │   ├── cache.client.ts     # CacheClient + 13 domain cache managers (948 lines)
│   │   └── redis.pubsub.ts     # ioredis pub/sub for SSE
│   ├── security/
│   │   └── sanitize.ts         # Input sanitization (DOMPurify + escape)
│   └── sse/
│       └── sse.channels.ts     # SSE channel definitions
│
├── redis/
│   └── redis.client.ts         # ioredis singleton + BILLING_CACHE
│
├── payment/                    # Payment provider abstraction
│   ├── IpaymentProvider.ts     # Provider-agnostic interface
│   ├── provider.registry.ts    # Singleton factory (stripe/paddle)
│   ├── webhook.handler.ts      # Idempotent webhook processing
│   ├── webhook.router.ts       # POST /webhooks/billing
│   └── providers/
│       ├── stripe/             # Stripe SDK implementation
│       ├── paddle/             # Paddle SDK implementation
│       └── mock/               # Mock provider for testing
│
├── queue/                      # BullMQ job queue system
│   ├── index.ts                # Queue worker lifecycle
│   ├── queues/                 # 6 queue definitions
│   │   ├── email.queue.ts
│   │   ├── notification.queue.ts
│   │   ├── activity.queue.ts
│   │   ├── calendar.queue.ts
│   │   ├── analytics.queue.ts
│   │   └── integration.queue.ts
│   └── workers/                # 6 worker implementations
│       ├── email.worker.ts
│       ├── notification.worker.ts
│       ├── activity.worker.ts
│       ├── calendar.worker.ts
│       ├── analytics.worker.ts
│       └── integration.worker.ts
│
├── sockets/
│   └── notification.stream.ts  # SSE handler (338 lines)
│
├── services/
│   └── slug.service.ts         # Slug generation with collision handling
│
├── types/
│   ├── notification.types.ts   # Notification DTOs + 10 templates
│   └── task.types.ts           # Task DTOs + filter types
│
├── utils/
│   ├── email.ts                # Email stub
│   ├── error.util.ts           # Legacy error classes
│   ├── plans.ts                # Profile update rate limits by plan
│   ├── taskScope.ts            # Task scope WHERE builder
│   └── tokenEncryption.ts      # AES-256-GCM token encryption at rest
│
├── keys/
│   ├── private.pem             # RSA private key — NEVER commit
│   └── public.pem              # RSA public key
│
├── scripts/
│   └── generate-keys.js        # RSA key pair generator
│
├── tests/                      # 230+ test files
│   ├── globalSetup.ts          # RSA key generation + DB schema push
│   ├── setup.ts                # Per-file mocks + DB cleanup
│   ├── smoke.test.ts           # Smoke tests
│   ├── factories/              # Test data factories (555 lines)
│   ├── helpers/                # Auth + CSRF test helpers
│   ├── contracts/              # 28 contract test files
│   ├── e2e/                    # 15 end-to-end test files
│   ├── integrations/           # 32 integration test files
│   └── unit/                   # 100+ unit test files (35 subdirectories)
│
└── performance/                # API benchmarking
    ├── run-tests.ts
    ├── api-tests.ts
    ├── simple-api-tests.ts
    ├── database-tests.ts
    ├── service-tests.ts
    ├── load-tests.ts
    └── check-server.ts
```

---

## 🔐 Authentication & Security

See [AUTHENTICATION.md](./AUTHENTICATION.md) for the full architecture.

### Authentication Flow

1. NextAuth (frontend) validates credentials or Google OAuth
2. NextAuth generates HMAC-SHA256 proof of the session
3. Frontend sends `POST /api/v1/auth/exchange` with the proof
4. Backend verifies HMAC proof and creates RS256 token pair
5. Access token: 15 min | Refresh token: 7 days with rotation

### Security Features

| Feature | Implementation |
|---------|---------------|
| **JWT** | RS256 asymmetric — private key never leaves this server |
| **Token Rotation** | Refresh tokens rotated atomically via Redis Lua script |
| **Replay Detection** | Refresh token JTIs tracked in Redis — replay attacks logged |
| **Session Binding** | IP + User-Agent fingerprint validated on every request |
| **Hijack Detection** | Device mismatch / suspicious IP changes -> all tokens revoked |
| **Account Lockout** | 10 failed attempts -> 15-minute lockout |
| **CSRF** | Double-submit cookie pattern with Redis-backed tokens |
| **Rate Limiting** | Per-user tier: free=60, pro=300, enterprise=1000 req/min |
| **IP Rate Limiting** | Redis sorted sets sliding window |
| **Audit Logging** | 40+ structured security event types |
| **Input Sanitization** | DOMPurify + escape-html + recursive object sanitization |
| **Security Headers** | CSP, HSTS, X-Frame-Options, COEP, COOP, CORP |
| **Password Hashing** | Argon2 |
| **Token Encryption** | AES-256-GCM for at-rest token storage |
| **Global Invalidation** | Token version field allows instant revocation of all tokens |

### CSRF Protection

All mutating routes require a valid CSRF token via the `requireCsrfToken()` middleware:

1. Client calls `GET /api/v1/csrf-token` and receives a token stored in Redis (1hr TTL)
2. Client attaches it as `X-CSRF-Token` header on every mutating request
3. `requireCsrfToken()` validates timing-safe comparison against Redis
4. On failure the frontend automatically refreshes the token and retries once

**Exempt routes:** `GET` requests, SSE stream, auth endpoints, public endpoints, Stripe webhook.

### Role-Based Access Control

| Role | Scope | Permissions |
|------|-------|-------------|
| `ADMIN` | Platform-wide | Full admin access |
| `WORKSPACE_OWNER` | Workspace | Full workspace control, billing, deletion |
| `WORKSPACE_ADMIN` | Workspace | Member management, project creation |
| `WORKSPACE_MEMBER` | Workspace | Task and project access |
| `WORKSPACE_VIEWER` | Workspace | Read-only access |

**18 granular permissions** across workspace, project, task, and billing domains.

---

## 🗄 Database Schema

### 60 Models

| Category | Models |
|----------|--------|
| **Auth & Users** | `User`, `Account`, `Session`, `VerificationToken`, `PasswordResetToken`, `RefreshToken`, `ApiKey` |
| **Workspaces** | `Workspace`, `WorkspaceMember`, `WorkspaceInvitation` |
| **Projects** | `Project`, `ProjectSection`, `ProjectMember`, `Sprint`, `ProjectMilestone`, `ProjectView`, `ProjectFavorite` |
| **Tasks** | `Task`, `TaskAssignee`, `TaskDependency`, `TaskRecurrence`, `DailyTask` |
| **Collaboration** | `Comment`, `CommentMention`, `Label`, `TaskLabel`, `File`, `UploadRateLimit` |
| **Meetings** | `Meeting`, `MeetingAttendee` |
| **Announcements** | `Announcement`, `AnnouncementTarget` |
| **Focus & Wellness** | `FocusSession`, `TimeEntry`, `UserCapacity`, `UserWorkSchedule`, `CalendarDayAggregate`, `GoalCheckpoint`, `SystemCalendarEvent`, `BurnoutSignal`, `EnergyLevel`, `WellnessRecommendation` |
| **Activity** | `Activity`, `Notification` |
| **Billing** | `Plan`, `Subscription`, `Invoice`, `Payment`, `UsageRecord`, `BillingEvent` |
| **Integrations** | `Integration` |
| **Automation & Templates** | `AutomationRule`, `ProjectTemplate`, `TemplateRating` |
| **CMS & Content** | `PopularResource`, `ProductUpdate`, `ContactMessage`, `JobPosting`, `TemplateList`, `SubscribeList` |
| **Feature Requests** | `FeatureRequest`, `FeatureVote` |

### Key Enums

`UserRole` (USER, ADMIN, SUPER_ADMIN), `WorkspacePlan` (FREE, PRO, BUSINESS, ENTERPRISE), `WorkspaceRole` (OWNER, ADMIN, MEMBER, GUEST), `ProjectStatus` (PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED), `TaskStatus` (TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, COMPLETED, CANCELLED), `Priority` (URGENT, HIGH, MEDIUM, LOW), `TaskEnergy`, `TaskIntent`, `FocusType` (POMODORO, SHORT_BREAK, LONG_BREAK, DEEP_WORK, CUSTOM), `ActivityType`, `EntityType`, `NotificationType` (20 types), `FeatureStatus`, `BurnoutRisk` (LOW, MODERATE, HIGH, CRITICAL), `BillingCycle`, `SubStatus`, `ContactCategory`, `JobDepartment`, `JobStatus`, `TemplateTier` (FREE, PRO, BUSINESS), `AutomationTrigger` (STATUS_CHANGED, TASK_CREATED), `AutomationActionType` (ASSIGN_USER, SET_PRIORITY, NOTIFY_MEMBERS), and 15+ more.

---

## 📡 API Reference

**Base URL:** `/api/v1`

All authenticated routes require `Authorization: Bearer <accessToken>`.
All mutating authenticated routes additionally require `X-CSRF-Token`.

### Authentication (3 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `POST` | `/api/v1/auth/exchange` | — | Exchange HMAC proof for RS256 token pair (idempotent) |
| `POST` | `/api/v1/auth/refresh` | — | Rotate refresh token (distributed lock, replay dedup) |
| `POST` | `/api/v1/auth/logout` | — | Revoke tokens (best-effort) |

### User (4 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/user/profile` | — | Get user profile |
| `PUT` | `/api/v1/user/profile` | ✓ | Update user profile |
| `PUT` | `/api/v1/user/password` | ✓ | Change password |
| `GET` | `/api/v1/user/workspace-members` | — | List members across user's workspaces |

### CSRF (1 endpoint)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/csrf-token` | Get CSRF token for session |

### Workspaces (16 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/workspaces` | — | List user workspaces (cached) |
| `POST` | `/api/v1/workspaces` | ✓ | Create workspace |
| `GET` | `/api/v1/workspaces/invitations/:token` | — | Get invitation details |
| `POST` | `/api/v1/workspaces/invitations/:token/accept` | — | Accept invitation |
| `GET` | `/api/v1/workspaces/:slug` | — | Get workspace by slug |
| `GET` | `/api/v1/workspaces/:slug/overview` | — | Get workspace overview (cached) |
| `PUT` | `/api/v1/workspaces/:id` | ✓ | Update workspace |
| `DELETE` | `/api/v1/workspaces/:id` | ✓ | Delete workspace |
| `GET` | `/api/v1/workspaces/:id/members` | — | Get workspace members |
| `POST` | `/api/v1/workspaces/:id/invite` | ✓ | Invite member |
| `DELETE` | `/api/v1/workspaces/:id/members/:memberId` | ✓ | Remove member |
| `PUT` | `/api/v1/workspaces/:id/members/:memberId/role` | ✓ | Update member role |
| `GET` | `/api/v1/workspaces/:id/stats` | — | Get workspace statistics |
| `POST` | `/api/v1/workspaces/:id/leave` | ✓ | Leave workspace |

### Projects & Sections (15 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/projects/user/all` | — | Get all user projects |
| `GET` | `/api/v1/projects/workspace/:workspaceId` | — | Get projects by workspace |
| `POST` | `/api/v1/projects` | ✓ | Create project |
| `GET` | `/api/v1/projects/slug/:slug` | — | Get project by slug |
| `GET` | `/api/v1/projects/:projectId` | — | Get project details |
| `PATCH` | `/api/v1/projects/:projectId` | ✓ | Update project |
| `DELETE` | `/api/v1/projects/:projectId` | ✓ | Delete project |
| `POST` | `/api/v1/projects/:projectId/members` | ✓ | Add project member |
| `PATCH` | `/api/v1/projects/:projectId/members/:memberId` | ✓ | Update member role |
| `DELETE` | `/api/v1/projects/:projectId/members/:memberId` | ✓ | Remove member |
| `GET` | `/api/v1/projects/:projectId/sections` | — | List workflow sections (columns) |
| `POST` | `/api/v1/projects/:projectId/sections` | ✓ | Create workflow section |
| `PUT` | `/api/v1/projects/:projectId/sections/reorder` | ✓ | Reorder workflow sections |
| `PATCH` | `/api/v1/projects/:projectId/sections/:sectionId` | ✓ | Update section (rename / WIP limit / status mapping) |
| `DELETE` | `/api/v1/projects/:projectId/sections/:sectionId` | ✓ | Delete section |

### Templates (11 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/templates/catalog` | — | Public tier-gated catalog (+ caller access tier) |
| `GET` | `/api/v1/templates/:slug` | — | Public template detail |
| `POST` | `/api/v1/templates` | — | Public template-waitlist email capture |
| `GET` | `/api/v1/templates` | ✓ | Admin: list waitlist emails |
| `DELETE` | `/api/v1/templates/:email` | ✓ | Admin: remove a waitlist email |
| `POST` | `/api/v1/templates/save-as-template/:projectId` | ✓ | Snapshot a project as a private template |
| `GET` | `/api/v1/templates/private` | ✓ | Workspace private templates |
| `POST` | `/api/v1/templates/:slug/use` | ✓ | Import a template as a new project (tier-gated) |
| `POST` | `/api/v1/templates/:slug/rate` | ✓ | Rate a template (1–5 stars, one per user) |
| `PATCH` | `/api/v1/templates/:slug` | ✓ | Update a template (author/admin) |
| `DELETE` | `/api/v1/templates/:slug` | ✓ | Delete a template (author/admin) |

### Automations (6 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/automations` | — | List automation rules (workspace / project scope) |
| `POST` | `/api/v1/automations` | ✓ | Create rule (plan-gated: FREE 10 / PRO 50 / BUSINESS 200 / ENTERPRISE unlimited) |
| `GET` | `/api/v1/automations/:id` | — | Get rule detail |
| `GET` | `/api/v1/automations/:id/runs` | — | Rule run history |
| `PATCH` | `/api/v1/automations/:id` | ✓ | Update rule / toggle enabled |
| `DELETE` | `/api/v1/automations/:id` | ✓ | Delete rule |

### Tasks (16 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/tasks` | — | List tasks (filtered, paginated, sorted) |
| `POST` | `/api/v1/tasks` | ✓ | Create task |
| `GET` | `/api/v1/tasks/stats` | — | Task statistics |
| `GET` | `/api/v1/tasks/quota/personal` | — | Personal task quota |
| `GET` | `/api/v1/tasks/quota/workspace/:workspaceId` | — | Workspace task quota |
| `GET` | `/api/v1/tasks/:id` | — | Get task detail |
| `GET` | `/api/v1/tasks/:id/overview` | — | Get task overview with time tracking |
| `PUT` | `/api/v1/tasks/:id` | ✓ | Update task |
| `PATCH` | `/api/v1/tasks/:id/status` | ✓ | Update task status |
| `DELETE` | `/api/v1/tasks/:id` | ✓ | Delete task |
| `PUT` | `/api/v1/tasks/:id/github-link` | ✓ | Link GitHub entity to task |
| `PUT` | `/api/v1/tasks/:id/github-unlink` | ✓ | Unlink GitHub entity |
| `PUT` | `/api/v1/tasks/:id/slack-link` | ✓ | Link Slack message to task |
| `PUT` | `/api/v1/tasks/:id/slack-unlink` | ✓ | Unlink Slack message from task |
| `POST` | `/api/v1/tasks/:id/recurrence` | ✓ | Upsert task recurrence schedule |
| `DELETE` | `/api/v1/tasks/:id/recurrence` | ✓ | Remove task recurrence |

### Subtasks (7 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/tasks/:taskId/subtasks` | — | List subtasks |
| `GET` | `/api/v1/tasks/:taskId/subtasks/stats` | — | Subtask statistics |
| `POST` | `/api/v1/tasks/:taskId/subtasks` | ✓ | Create subtask |
| `GET` | `/api/v1/tasks/:taskId/subtasks/:subtaskId` | — | Get subtask |
| `PUT` | `/api/v1/tasks/:taskId/subtasks/:subtaskId` | ✓ | Update subtask |
| `PATCH` | `/api/v1/tasks/:taskId/subtasks/:subtaskId/status` | ✓ | Update subtask status |
| `DELETE` | `/api/v1/tasks/:taskId/subtasks/:subtaskId` | ✓ | Delete subtask |

### Comments (4 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/tasks/:taskId/comments` | — | List comments |
| `POST` | `/api/v1/tasks/:taskId/comments` | ✓ | Add comment (supports @mentions) |
| `PUT` | `/api/v1/tasks/:taskId/comments/:commentId` | ✓ | Update comment |
| `DELETE` | `/api/v1/tasks/:taskId/comments/:commentId` | ✓ | Delete comment |

### Attachments (3 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/tasks/:taskId/attachments` | — | Get task attachments |
| `POST` | `/api/v1/tasks/:taskId/attachments` | ✓ | Upload attachment (multipart) |
| `DELETE` | `/api/v1/tasks/:taskId/attachments/:attachmentId` | ✓ | Delete attachment |

### Labels (9 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/labels` | — | List labels (paginated) |
| `GET` | `/api/v1/labels/popular` | — | Get popular labels |
| `GET` | `/api/v1/labels/:id` | — | Get label by ID |
| `GET` | `/api/v1/labels/:id/tasks` | — | Get tasks with label |
| `POST` | `/api/v1/labels` | ✓ | Create label |
| `PATCH` | `/api/v1/labels/:id` | ✓ | Update label |
| `DELETE` | `/api/v1/labels/:id` | ✓ | Delete label |
| `POST` | `/api/v1/labels/:labelId/tasks/:taskId` | ✓ | Assign label to task |
| `DELETE` | `/api/v1/labels/:labelId/tasks/:taskId` | ✓ | Remove label from task |

### Notifications (8 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/notifications/stream` | — | SSE stream (30s single-use token in query string) |
| `GET` | `/api/v1/notifications` | — | Paginated list (read replica) |
| `GET` | `/api/v1/notifications/unread-count` | — | Badge count (primary DB) |
| `PATCH` | `/api/v1/notifications/:id/read` | ✓ | Mark as read |
| `PATCH` | `/api/v1/notifications/read-all` | ✓ | Mark all as read |
| `DELETE` | `/api/v1/notifications/:id` | ✓ | Delete notification |
| `DELETE` | `/api/v1/notifications/read/all` | ✓ | Delete all read |
| `GET` | `/api/v1/notifications/metrics` | — | Debug metrics (dev only) |

### Calendar and Wellness (19 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/calendar/aggregates` | — | Calendar day aggregates |
| `GET` | `/api/v1/calendar/insights` | — | Calendar insights |
| `GET` | `/api/v1/calendar/system-events` | — | System calendar events |
| `GET` | `/api/v1/calendar/goals` | — | Goal checkpoints |
| `POST` | `/api/v1/calendar/goals` | ✓ | Create goal checkpoint |
| `GET` | `/api/v1/calendar/capacity` | — | User capacity settings |
| `PUT` | `/api/v1/calendar/capacity` | ✓ | Update capacity |
| `GET` | `/api/v1/calendar/schedule` | — | User work schedule |
| `PUT` | `/api/v1/calendar/schedule` | ✓ | Update schedule |
| `GET` | `/api/v1/calendar/energy` | — | Current energy level |
| `GET` | `/api/v1/calendar/energy/history` | — | Energy level history |
| `GET` | `/api/v1/calendar/energy/export` | — | Export energy history as CSV |
| `POST` | `/api/v1/calendar/energy` | ✓ | Log energy level |
| `GET` | `/api/v1/calendar/burnout-trends` | — | Burnout trend data |
| `GET` | `/api/v1/calendar/recommendations` | — | Wellness recommendations |
| `PATCH` | `/api/v1/calendar/recommendations/:id/dismiss` | ✓ | Dismiss recommendation |
| `POST` | `/api/v1/calendar/recommendations/dismiss-all` | ✓ | Dismiss all recommendations |
| `POST` | `/api/v1/calendar/recalculate` | ✓ | Force recalculate aggregates |
| `POST` | `/api/v1/calendar/initialize` | ✓ | Initialize user calendar settings |

### Focus Sessions (7 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `POST` | `/api/v1/focus-sessions/start` | ✓ | Start focus session |
| `GET` | `/api/v1/focus-sessions/active` | — | Get active session |
| `GET` | `/api/v1/focus-sessions/history` | — | Get session history |
| `GET` | `/api/v1/focus-sessions/stats` | — | Get session statistics |
| `GET` | `/api/v1/focus-sessions/daily-summary` | — | Today's focus summary (sessions, minutes, per-type) |
| `POST` | `/api/v1/focus-sessions/:id/complete` | ✓ | Complete session |
| `POST` | `/api/v1/focus-sessions/:id/cancel` | ✓ | Cancel session |

### Analytics (12 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/analytics/:workspaceId/overview` | — | Workspace KPI overview (cached) |
| `GET` | `/api/v1/analytics/:workspaceId/projects/:projectId/overview` | — | Project overview |
| `GET` | `/api/v1/analytics/:workspaceId/tasks/trends` | — | Task completion trends |
| `GET` | `/api/v1/analytics/:workspaceId/projects/:projectId/tasks/trends` | — | Project task trend |
| `GET` | `/api/v1/analytics/:workspaceId/projects/health` | — | Project health status |
| `GET` | `/api/v1/analytics/:workspaceId/projects/:projectId/members/contribution` | — | Project member contributions |
| `GET` | `/api/v1/analytics/:workspaceId/projects/:projectId/time/summary` | — | Project time summary |
| `GET` | `/api/v1/analytics/:workspaceId/members/contribution` | — | Workspace member contributions |
| `GET` | `/api/v1/analytics/:workspaceId/time/summary` | — | Workspace time summary |
| `GET` | `/api/v1/analytics/:workspaceId/activity/trends` | — | Activity volume trends |
| `GET` | `/api/v1/analytics/:workspaceId/workload` | — | Member workload distribution |
| `GET` | `/api/v1/analytics/:workspaceId/projects/:projectId/deadline-risk` | — | Deadline risk analysis |

### Storage (9 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/storage/workspaces` | — | Storage summary across workspaces |
| `GET` | `/api/v1/storage/:workspaceId/overview` | — | Storage overview (cached) |
| `GET` | `/api/v1/storage/:workspaceId/info` | — | Storage info |
| `GET` | `/api/v1/storage/:workspaceId/my-contribution` | — | Current user's contribution |
| `GET` | `/api/v1/storage/:workspaceId/user-contributions` | — | All users' contributions |
| `GET` | `/api/v1/storage/:workspaceId/largest-files` | — | Largest files (cached) |
| `POST` | `/api/v1/storage/:workspaceId/bulk-delete` | ✓ | Bulk delete files |
| `DELETE` | `/api/v1/storage/files/:fileId` | ✓ | Delete single file |
| `POST` | `/api/v1/storage/:workspaceId/check-upload` | ✓ | Check if upload allowed |

### File Management (4 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/files/:workspaceId/files` | — | List files in workspace |
| `DELETE` | `/api/v1/files/:workspaceId/files/:fileId` | ✓ | Delete file |
| `GET` | `/api/v1/files/:workspaceId/stats` | — | File statistics |
| `GET` | `/api/v1/files/:workspaceId/uploaders` | — | List uploaders |

### Upload (1 endpoint)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `POST` | `/api/v1/upload` | ✓ | Upload file (multipart) |

### Activity (5 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/activity` | — | Get activities |
| `GET` | `/api/v1/activity/workspace/:workspaceId` | — | Workspace activities |
| `GET` | `/api/v1/activity/task/:taskId` | — | Task activities |
| `DELETE` | `/api/v1/activity/clear` | ✓ | Bulk clear activities |
| `DELETE` | `/api/v1/activity/:activityId` | ✓ | Delete activity |

### Daily Tasks (5 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/daily-tasks` | — | Get daily tasks for date |
| `POST` | `/api/v1/daily-tasks` | ✓ | Add task to daily list |
| `DELETE` | `/api/v1/daily-tasks/:taskId` | ✓ | Remove task from daily list |
| `GET` | `/api/v1/daily-tasks/stats` | — | Daily task completion stats |
| `POST` | `/api/v1/daily-tasks/clear-expired` | ✓ | Clear expired daily tasks |

### Meetings (5 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/meetings` | — | List meetings |
| `GET` | `/api/v1/meetings/:id` | — | Get meeting detail |
| `POST` | `/api/v1/meetings` | ✓ | Create meeting |
| `PUT` | `/api/v1/meetings/:id` | ✓ | Update meeting |
| `DELETE` | `/api/v1/meetings/:id` | ✓ | Delete meeting |

### Announcements (workspace + project scoped)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/workspaces/:slug/announcements` | — | List workspace announcements |
| `POST` | `/api/v1/workspaces/:slug/announcements` | ✓ | Create announcement |
| `PUT` | `/api/v1/workspaces/:slug/announcements/:id` | ✓ | Update announcement |
| `DELETE` | `/api/v1/workspaces/:slug/announcements/:id` | ✓ | Delete announcement |

### Feature Requests (5 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/features` | — | List feature requests |
| `POST` | `/api/v1/features` | ✓ | Submit feature request |
| `PATCH` | `/api/v1/features/:id` | ✓ | Update feature status |
| `POST` | `/api/v1/features/:id/vote` | ✓ | Vote on feature |
| `DELETE` | `/api/v1/features/:id` | ✓ | Delete feature request |

### Billing (6 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/billing/:workspaceId` | — | Get billing info |
| `POST` | `/api/v1/billing/:workspaceId/checkout` | ✓ | Create checkout session |
| `POST` | `/api/v1/billing/:workspaceId/portal` | ✓ | Create portal session |
| `POST` | `/api/v1/billing/:workspaceId/upgrade` | ✓ | Upgrade plan |
| `POST` | `/api/v1/billing/:workspaceId/cancel` | ✓ | Cancel subscription |
| `POST` | `/webhooks/billing` | — | Stripe/Paddle webhook (raw body) |

### Integrations (6 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/integrations` | — | List user integrations |
| `POST` | `/api/v1/integrations/auth` | ✓ | Initiate OAuth flow |
| `DELETE` | `/api/v1/integrations/:id` | ✓ | Disconnect integration |
| `PUT` | `/api/v1/integrations/:id/config` | ✓ | Update integration config |
| `POST` | `/api/v1/integrations/:id/sync` | ✓ | Sync integration |
| `POST` | `/api/v1/integrations/webhook/:provider` | — | Integration webhook |

### Admin (13 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/admin/stats` | ✓ | Platform-wide metrics |
| `GET` | `/api/v1/admin/workspaces` | ✓ | List workspaces |
| `GET` | `/api/v1/admin/workspaces/:slug` | ✓ | Workspace detail |
| `PATCH` | `/api/v1/admin/workspaces/:slug/limits` | ✓ | Update workspace limits |
| `POST` | `/api/v1/admin/workspaces/:slug` | ✓ | Delete workspace |
| `PATCH` | `/api/v1/admin/workspaces/:slug/restore` | ✓ | Restore workspace |
| `GET` | `/api/v1/admin/users` | ✓ | List users |
| `GET` | `/api/v1/admin/users/:id` | ✓ | User detail |
| `PATCH` | `/api/v1/admin/users/:id/ban` | ✓ | Ban user |
| `PATCH` | `/api/v1/admin/users/:id/unban` | ✓ | Unban user |
| `GET` | `/api/v1/admin/projects` | ✓ | List projects |
| `GET` | `/api/v1/admin/billing` | ✓ | Billing overview |
| `GET` | `/api/v1/admin/activity` | ✓ | Activity feed |

### Resources and CMS (8 endpoints)

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/resources/popular` | — | List popular resources |
| `POST` | `/api/v1/resources/popular` | ✓ | Create popular resource |
| `PUT` | `/api/v1/resources/popular/:id` | ✓ | Update popular resource |
| `DELETE` | `/api/v1/resources/popular/:id` | ✓ | Delete popular resource |
| `GET` | `/api/v1/resources/updates` | — | List product updates |
| `POST` | `/api/v1/resources/updates` | ✓ | Create product update |
| `PUT` | `/api/v1/resources/updates/:id` | ✓ | Update product update |
| `DELETE` | `/api/v1/resources/updates/:id` | ✓ | Delete product update |

### Other Endpoints

| Method | Route | CSRF | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/contact` | — | List contact messages (admin) |
| `POST` | `/api/v1/contact` | — | Submit contact message |
| `GET` | `/api/v1/jobs` | — | List job postings |
| `GET` | `/api/v1/jobs/:slug` | — | Get job posting |
| `POST` | `/api/v1/jobs` | ✓ | Create job posting (admin) |
| `PUT` | `/api/v1/jobs/:id` | ✓ | Update job posting (admin) |
| `DELETE` | `/api/v1/jobs/:id` | ✓ | Delete job posting (admin) |
| `POST` | `/api/v1/subscribe` | — | Email subscription |
| `POST` | `/api/v1/internal/failed-attempt` | — | Internal: record failed login |
| `POST` | `/api/v1/internal/clear-attempts` | — | Internal: clear login attempts |
| `GET` | `/health` | — | Health check |
| `GET` | `/health/db-pool` | — | DB pool health check |

**Total: ~133 API endpoints**

---

## 📡 Real-Time Notifications (SSE + Redis Pub/Sub)

```
Client -> GET /api/v1/notifications/stream?token=<sseToken>   (30s, single-use)
Backend -> verifyToken(token, "sse")   -> rejects access/refresh tokens
       -> consumeSseToken(jti)         -> atomic single-use consume (replay -> 401)
       -> userId from consumed binding
       -> await SUBSCRIBE sse:user:<userId> (Redis confirmed)
       -> write "connected" handshake
       -> keep connection open
```

### Why pub/sub instead of in-memory Map:
- Works across multiple backend instances
- Notifications are durable in Postgres — Redis failure never loses data
- One Redis SUBSCRIBE per unique userId per process regardless of tab count

### Two ioredis clients (separate TCP connections):

| Client | Purpose |
|--------|---------|
| `getPublisher()` | Sends PUBLISH — stays in normal mode |
| `getSubscriber()` | Dedicated SUBSCRIBE/UNSUBSCRIBE |

### Connection Management:
- Per-user limit: 5 connections
- Global limit: 10,000 connections
- Heartbeat: every 25 seconds
- Write-with-retry: 3 attempts per failed SSE write
- Delivery tracking: Redis persistence (1h TTL) + in-memory log (max 1000 entries)

### Notification dispatch helpers:

```ts
await notifyUser({ userId, type, title, message, actionUrl });
await notifyTaskAssignees({ taskId, senderId, type, title, message, excludeUserId });
await notifyWorkspaceMembers({ workspaceId, senderId, type, title, message });
await notifyMentions({ text, workspaceId, senderId, senderName, context, actionUrl });
```

Each call writes to Postgres first (durable), then PUBLISHes to Redis.

---

## ⚡ Caching

Read-heavy endpoints are cached in Upstash Redis (REST) via `CacheClient` in `lib/redis/cache.client.ts`.

### Cached Resources and TTLs

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
| Project metadata | 1 hour | Project update/delete |
| Task stats | 30 min | Task mutations |
| Activity feed | 15 min | Activity creation |
| Calendar aggregates | 1 hour | Calendar mutations |
| Focus session stats | 30 min | Focus session mutations |
| User profile | 1 hour | Profile update |
| Access control | 1 hour | Role/membership changes |
| External API results | 5 min | Integration sync |

### 14 Cache Namespaces

`WorkspaceCache`, `LabelCache`, `AnalyticsCache`, `StorageCache`, `ProjectCache`, `TaskCache`, `AutomationCache`, `ActivityCache`, `CalendarCache`, `FocusSessionCache`, `UserCache`, `ExternalApiCache`, `NotificationCache`, `AccessControlCache`

`CacheClient.getOrSet(key, fetcher, ttl)` — fetches from cache, falls back to DB, repopulates automatically.

---

## 💳 Payment Providers

### Provider Abstraction

```
IPaymentProvider (interface)
    ├── StripeProvider (providers/stripe/)
    ├── PaddleProvider (providers/paddle/)
    └── MockProvider (providers/mock/) — for testing
```

Selected via `PAYMENT_PROVIDER` env var (`stripe` or `paddle`).

### Supported Operations
- `createCustomer` — Create billing customer
- `createCheckoutSession` — Create checkout session
- `createPortalSession` — Create customer portal
- `changePlan` — Upgrade/downgrade with proration
- `cancelSubscription` — Cancel at period end
- `reactivateSubscription` — Reactivate canceled subscription
- `verifyAndParseWebhook` — Verify webhook signature and normalize event

### Webhook Processing

Provider-agnostic webhook handler (`payment/webhook.handler.ts`):
- Idempotent via `BillingEvent` table (prevents double-processing)
- Handles: CHECKOUT_COMPLETED, SUBSCRIPTION_CREATED/UPDATED/CANCELED, TRIAL_ENDING, INVOICE_PAID/FAILED/CREATED/UPDATED
- Updates workspace plan, subscription status, invoice records
- Invalidates billing and workspace caches after mutations

---

## 📦 Job Queue (BullMQ)

### 7 Queues with Dedicated Workers

| Queue | Concurrency | Purpose |
|-------|-------------|---------|
| `email` | 5 (rate-limited 10/s) | Email sending (contact notification, auto-reply, ban, workspace-deleted, invitation) |
| `notification` | 10 | Notification creation + SSE delivery (individual + bulk) |
| `activity` | 10 | Activity logging, cache invalidation, storage quota updates |
| `calendar` | 3 | Calendar aggregate computation, insights, pre-computation |
| `analytics` | 2 | Analytics pre-computation, focus streak calculation |
| `integration` | 5 (rate-limited 20/s) | Third-party integration sync, webhook processing |
| `automation` | 1 (default) | Automation-rule evaluation + action execution (20-run burst cap per rule) |

### Job Types

- **Email:** contact notification, auto-reply, ban notification, workspace-deleted, invitation
- **Notification:** send individual, send to task assignees, send to workspace members
- **Activity:** log activity, invalidate cache, update storage quota
- **Calendar:** compute aggregates, compute insights, pre-compute user calendar
- **Analytics:** pre-compute analytics, compute focus streak
- **Integration:** sync integration, process webhook
- **Automation:** evaluate rules, execute actions (assign, set priority, notify members)

---

## ⏰ Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Task reminder | Every 5 minutes | Notifies assignees 6h, 3h, 30m before due date |
| Overdue alerts | Every 5 minutes | Notifies assignees 1h, 6h, 24h after due date |
| Notification cleanup | Daily at 3 AM | Deletes read notifications older than 30 days |
| Daily task reset | Scheduled | Handled via `dailyTask.cron.ts` |
| Wellness monitoring | Daily at 6 AM | Generates wellness recommendations via `wellness.cron.ts` |
| Burnout signals | Weekly Monday 7 AM | Batch pre-computes `BurnoutSignal` rows via `burnoutSignal.cron.ts` |
| Task recurrence | Daily at 1 AM | Idempotently generates due recurring-task instances via `taskRecurrence.cron.ts` |

Redis dedup keys (`notif:sent:<taskId>:<userId>:<type>:<label>`) prevent double-firing across cron runs. TTL is set to 25 hours.

---

## 🧪 Testing

### Test Structure (230+ files)

| Directory | Count | Purpose |
|-----------|-------|---------|
| `contracts/` | 28 | API contract tests with Zod validation |
| `e2e/` | 15 | End-to-end workflow tests |
| `integrations/` | 32 | Module integration tests with real DB |
| `unit/` | 100+ | Unit tests across 35 subdirectories |

### Test Infrastructure

- **Framework:** Vitest 3.2.4 (node environment, globals enabled)
- **HTTP Testing:** Supertest 7.2.2
- **Mocking:** MSW 2.13.3 + vi.mock for Redis, Cloudinary, Stripe, nodemailer
- **Factories:** Custom test data factories (555 lines) for User, Workspace, Project, Task, Meeting, Announcement, Label, FeatureRequest, Activity, JobPosting
- **Setup:** RSA key generation, Prisma schema push, data seeding in globalSetup; per-file DB cleanup with FK-safe ordering
- **Pool:** `forks` with `singleFork: true` to prevent PG prepared statement conflicts
- **Coverage:** v8 provider, 70% lines / 70% functions / 60% branches thresholds

### Commands

```bash
npm run test                    # Run all tests
npm run test:unit               # Unit tests only
npm run test:integration        # Integration tests only
npm run test:coverage           # With coverage report
npm run test:verbose            # Verbose output
npm run test:performance        # API benchmarking
npm run test:performance:api    # API endpoint benchmarks
npm run test:performance:load   # Load testing
```

---

## 🧪 Performance Benchmarking

```bash
npm run test:performance:api
```

Required env vars:

```env
BENCH_BASE_URL=http://localhost:5000/api/v1
BENCH_ACCESS_TOKEN=<valid access token>
BENCH_WORKSPACE_ID=<workspace id>
BENCH_RUNS=20
BENCH_CONCURRENCY=1
```

Reports `avg`, `min`, `max`, `p95`, and `p99` latencies for workspace usage, storage, and analytics endpoints.

---

## 🚀 Local Development

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

### 4. Seed plans

```bash
npm run db:seed
```

### 5. Run the server

```bash
npm run dev
```

Server runs on `http://localhost:5000`.

### Docker (optional)

```bash
docker-compose up -d
```

Starts PostgreSQL 16 and Redis 7 for local development.

---

## 🔧 Environment Variables

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

# DB Pool Tuning
DB_MAX_CONNECTIONS=100
PRIMARY_POOL_RATIO=0.3
REPLICA_POOL_RATIO=0.7
QUERY_TIMEOUT_MS=30000
INSTANCE_COUNT=1

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
REDIS_URL=rediss://...

# Sentry
SENTRY_DSN=

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_BUSINESS_MONTHLY=
STRIPE_PRICE_BUSINESS_YEARLY=

# Paddle
PADDLE_API_KEY=
PADDLE_API_SECRET=

# Payment Provider (stripe or paddle)
PAYMENT_PROVIDER=stripe

# Integrations
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
TRELLO_CLIENT_ID=
TRELLO_CLIENT_SECRET=

# Admin
FOCURA_ADMIN_IDS=

# Ngrok (development)
NGROK_AUTH_TOKEN=
```

---

## 🚀 Deployment

### Railway

The backend is deployed on Railway. Configuration in `railway.json`:

```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "numReplicas": 1,
    "startCommand": "npm run deploy",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

The `deploy` script runs: `npm run build && prisma migrate deploy && npm start`

### Render

Also deployed at https://focura-backend-vr75.onrender.com

### Deploy Command

```bash
npm run deploy
```

This runs: `tsc && prisma migrate deploy && node dist/index.js`

---

## 📚 Documentation

- [**AUTHENTICATION.md**](./AUTHENTICATION.md) — Complete authentication and security architecture
- [**BACKEND_ANALYSIS.md**](./BACKEND_ANALYSIS.md) — Backend codebase analysis
- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — Contribution guide (setup, architecture rules, testing)
- [**DATABASE_POOL_FIXES.md**](./DATABASE_POOL_FIXES.md) — DB connection pool fixes
- [**DEPLOYMENT.MD**](./DEPLOYMENT.MD) — Deployment guide
- [**FRONTEND_AUTH_GUIDE.md**](./FRONTEND_AUTH_GUIDE.md) — Frontend auth integration guide
- [**PERFORMANCE_TESTING.md**](./PERFORMANCE_TESTING.md) — Performance testing guide
- [**PROJECT_VISION.md**](./PROJECT_VISION.md) — Project vision and roadmap
- [**SENTRY_SETUP.md**](./SENTRY_SETUP.md) — Sentry error tracking setup

---

## 🔗 Quick Links

- **Backend API:** https://focura-backend-vr75.onrender.com
- **Health Check:** https://focura-backend-vr75.onrender.com/health
- **Client Repository:** https://github.com/gaziraihan1/focura-client
- **Issues:** https://github.com/gaziraihan1/focura-backend/issues

---

## 📄 License

This project is currently private / source-available. License details will be added in the future.

---

## 👤 Maintainer

**Mohammad Raihan Gazi** — Creator & Maintainer of Focura

- GitHub: [@gaziraihan1](https://github.com/gaziraihan1)