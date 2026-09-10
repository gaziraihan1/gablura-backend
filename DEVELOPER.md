# Gablura Backend — Developer Guide

Everything you need to set up, run, test, and contribute to this project without confusion.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Architecture Patterns](#architecture-patterns)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Database Management](#database-management)
- [Common Commands](#common-commands)
- [Troubleshooting](#troubleshooting)
- [Key Concepts](#key-concepts)

---

## Overview

Gablura Backend is a **modular monolith** Express.js API built with TypeScript. It powers a productivity SaaS platform with task management, focus sessions, calendar intelligence, AI features, billing, and more.

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22.x |
| Framework | Express.js | 5.1.0 |
| Language | TypeScript | 5.9.3 |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 5.22.0 |
| Cache / Queue | Redis (ioredis) + BullMQ | 5.10.0 / 5.80.2 |
| Testing | Vitest + Supertest + MSW | 3.2.4 |

---

## Prerequisites

Before you start, install these on your machine:

- **Node.js 22.x** — check with `node -v`
- **npm** — comes with Node
- **PostgreSQL 16** — local install or via Docker
- **Redis 7** — local install or via Docker
- **Git**

Optional but recommended:
- **Docker + Docker Compose** — for spinning up Postgres and Redis without installing them locally

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/gaziraihan1/gablura-backend.git
cd gablura-backend
```

### 2. Install dependencies

This also runs `prisma generate` automatically via the `postinstall` script:

```bash
npm install
```

### 3. Create your environment file

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/focura_dev
DIRECT_URL=postgresql://postgres:password@localhost:5432/focura_dev
NEXTAUTH_SECRET=your-secret-here
CLIENT_URL=http://localhost:3000
REDIS_URL=redis://127.0.0.1:6379
```

### 4. Start Postgres and Redis (if not using local installs)

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port `5433` (user: `postgres`, password: `postgres`, db: `_test`)
- Redis on port `6379`

**Note:** The docker-compose is configured for testing (port 5433). For local development you can either:
- Use the docker-compose as-is and adjust your `DATABASE_URL` to port 5433
- Install Postgres locally on port 5432
- Modify the `docker-compose.yml` to use port 5432

### 5. Generate RSA keys (first time only)

```bash
node scripts/generate-keys.js
```

This creates `keys/private.pem` and `keys/public.pem` (gitignored).

### 6. Run database migrations and seed

```bash
npx prisma migrate dev
npm run db:seed
```

The seed creates the billing plans (Free, Pro, Business).

### 7. Start the dev server

```bash
npm run dev
```

Server runs on `http://localhost:5000` with hot reload via nodemon + tsx.

---

## Environment Variables

Copy `.env.example` to `.env`. Here's what each group does:

### Required for basic operation

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
DIRECT_URL=postgresql://user:pass@localhost:5432/dbname
NEXTAUTH_SECRET=any-random-string-32-chars-min
REDIS_URL=redis://127.0.0.1:6379
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
```

### Optional — only needed for specific features

| Variable | Needed for | Default |
|----------|-----------|---------|
| `READ_DATABASE_URL` | Read replica (analytics, feeds) | Falls back to `DATABASE_URL` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email sending | — |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | File uploads | — |
| `GEMINI_API_KEY` | AI features | — |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe billing | — |
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` | Lemon Squeezy billing | — |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | Paddle billing | — |
| `SENTRY_DSN` | Error tracking | — |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub integration | — |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack integration | — |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar integration | — |
| `TRELLO_CLIENT_ID`, `TRELLO_CLIENT_SECRET` | Trello integration | — |

### Connection Pool Tuning

```env
DB_MAX_CONNECTIONS=100
INSTANCE_COUNT=1
PRIMARY_POOL_RATIO=0.3
REPLICA_POOL_RATIO=0.7
QUERY_TIMEOUT_MS=30000
```

For local development, the defaults work fine. Only tune these for production or multi-instance deployments.

---

## Project Structure

```
focura-backend/
├── src/
│   ├── index.ts                  # Entry point — Express setup, route registration, cron init
│   ├── app.ts                    # Express app factory (used by tests)
│   │
│   ├── config/                   # Admin config
│   ├── middleware/                # Auth, CSRF, RBAC, rate limiting, security headers
│   ├── errors/                   # AppError classes + global error handler
│   │
│   ├── modules/                  # 26 domain modules (the core of the app)
│   │   ├── task/                 # Example: Task management
│   │   │   ├── task.routes.ts    #   Route definitions
│   │   │   ├── task.controller.ts#   Request/response handling (thin)
│   │   │   ├── task.query.ts     #   Read operations (Prisma SELECT)
│   │   │   ├── task.mutation.ts  #   Write operations (Prisma CREATE/UPDATE/DELETE)
│   │   │   ├── task.selects.ts   #   Reusable Prisma select/include
│   │   │   ├── task.types.ts     #   TypeScript types
│   │   │   ├── task.validators.ts#   Zod validation schemas
│   │   │   ├── task.access.ts    #   Permission checks
│   │   │   ├── task.activity.ts  #   Activity feed logging
│   │   │   ├── task.notifications.ts # Notification dispatch
│   │   │   └── index.ts          #   Barrel export
│   │   ├── workspace/            # Workspace CRUD + membership
│   │   ├── project/              # Project management + sections + sprints
│   │   ├── calendar/             # Calendar, wellness, energy, burnout
│   │   ├── billing/              # Billing/subscriptions
│   │   ├── notification/         # SSE + notifications
│   │   └── ... (26 modules total)
│   │
│   ├── admin/                    # Super-admin panel
│   ├── routes/                   # Top-level routes (auth, user, internal)
│   ├── controllers/              # Top-level controllers
│   ├── lib/                      # Shared utilities (Prisma, Redis, auth, SSE)
│   ├── redis/                    # ioredis singleton
│   ├── payment/                  # Payment provider abstraction
│   ├── queue/                    # BullMQ workers + queues
│   ├── sockets/                  # SSE handler
│   ├── services/                 # Shared services
│   ├── types/                    # Shared types
│   ├── utils/                    # Utility functions
│   ├── keys/                     # RSA keys (gitignored)
│   ├── scripts/                  # Utility scripts
│   └── tests/                    # Test suite (230+ files)
│
├── prisma/
│   ├── schema.prisma             # Database schema (60 models)
│   ├── seed.ts                   # Plan seeding
│   └── migrations/               # Migration history
│
├── .env.example                  # Environment template
├── package.json                  # Dependencies + scripts
├── tsconfig.json                 # TypeScript config
├── vitest.config.ts              # Test configuration
├── docker-compose.yml            # Postgres + Redis for dev/test
└── openapi.yaml                  # API specification
```

---

## Architecture Patterns

### Module Structure

Each domain lives in `src/modules/<domain>/` and is fully self-contained. Follow this pattern:

```
src/modules/<domain>/
├── <domain>.routes.ts       # Route registration only
├── <domain>.controller.ts   # Request/response — thin layer, no Prisma
├── <domain>.query.ts        # Read operations (uses prismaRead)
├── <domain>.mutation.ts     # Write operations (uses prisma)
├── <domain>.selects.ts      # Reusable Prisma select/include
├── <domain>.types.ts        # TypeScript types
├── <domain>.validators.ts   # Zod input validation
├── <domain>.access.ts       # Permission checks
├── <domain>.activity.ts     # Activity feed logging
├── <domain>.notifications.ts# Notification dispatch
├── <domain>.filters.ts      # Query filtering
├── <domain>.analytics.ts    # Stats/analytics logic
├── <domain>.cron.ts         # Scheduled jobs
├── <domain>.service.ts      # Business logic (optional)
└── index.ts                 # Barrel export
```

### Key Rules

1. **Controllers are thin** — validate input, call query/mutation, return response. Never write Prisma queries in controllers.

2. **Two Prisma clients:**
   - `prisma` — primary (read-write), used for all mutations
   - `prismaRead` — read replica, used for analytics, feeds, lists, stats

3. **Validate all input with Zod** in `<domain>.validators.ts`.

4. **Use the error system** — throw `AppError` subclasses for consistent error responses.

5. **Workspace isolation** — every cross-workspace query must be scoped by membership/role.

6. **Cache invalidation** — called from mutations via `lib/redis/cache.client.ts`.

7. **Notification dispatch** — go through `modules/notification/notification.helpers.ts`.

### Adding a New Endpoint

1. Add Zod schema in `<domain>.validators.ts`
2. Implement read/write in `<domain>.query.ts` / `<domain>.mutation.ts`
3. Wire controller + route in `<domain>.routes.ts`
4. Export through `<domain>/index.ts`
5. Register router in `src/index.ts` (with `authenticate` + `requireCsrfToken()` for mutations)
6. Add tests

### Adding a Cron Job

1. Create `<domain>.cron.ts` exporting an `init*Crons()` function
2. Batch-process users with pagination
3. Call the init function in `src/index.ts`

### Background Jobs

Long-running work goes through BullMQ:
- Define job type + helper in `src/queue/queues/*.queue.ts`
- Implement handler in `src/queue/workers/*.worker.ts`
- Workers registered in `src/queue/index.ts`

---

## Development Workflow

### Starting Fresh

```bash
# 1. Start databases
docker-compose up -d

# 2. Install deps (runs prisma generate)
npm install

# 3. Setup database
npx prisma migrate dev

# 4. Seed plans
npm run db:seed

# 5. Start dev server
npm run dev
```

### Hot Reload

The dev server uses **nodemon + tsx** which watches `src/` for `.ts` and `.json` changes and restarts automatically.

### Making Schema Changes

```bash
# Create a migration (opens SQL file for review)
npm run prisma:migrate:create

# Apply the migration
npm run prisma:migrate

# Regenerate Prisma client
npm run prisma:generate
```

**Important:** Always backfill data in the same migration file if adding a column that needs existing data. Never make a relation nullable unless consumers handle `null`.

### Syncing Frontend Contracts

If you change API response shapes:

```bash
npm run sync:contracts
```

This regenerates frontend type files. Contract tests enforce consistency.

---

## Testing

### Test Database

Tests require a separate database. Create `.env.test`:

```bash
cp .env.example .env.test
```

Set in `.env.test`:

```env
TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/_test
```

The test database is reset automatically on each run (`prisma db push --force-reset`).

### Running Tests

```bash
npm test                      # All tests
npm run test:unit             # Unit tests only
npm run test:integration      # Integration tests only
npm run test:coverage         # With coverage report
npm run test:verbose          # Verbose output

# Run a specific file
npx vitest run src/tests/unit/calendar/wellness.service.test.ts

# Run tests in a specific directory
npx vitest run src/tests/unit/calendar

# Watch mode
npm run test:watch
```

### Test Structure

| Directory | Purpose |
|-----------|---------|
| `src/tests/unit/` | Unit tests with mocked dependencies |
| `src/tests/integrations/` | Integration tests with real DB |
| `src/tests/contracts/` | API contract validation (Zod) |
| `src/tests/e2e/` | End-to-end workflow tests |
| `src/tests/factories/` | Test data factories |
| `src/tests/helpers/` | Auth + CSRF test helpers |

### Writing Tests

- **Unit tests:** Mock `prisma`, Redis, external services with `vi.mock`. Assert pure logic.
- **Integration tests:** Use factories from `src/tests/factories/` and `cleanAllTestData()` in `beforeEach`.
- **Never** leave tests that require real secrets, network access, or live API keys — mock everything.

### Before Submitting

```bash
npm run lint                  # No lint errors
npx tsc --noEmit              # No type errors
npm test                      # All tests pass
```

---

## Database Management

### Useful Commands

```bash
npx prisma studio             # Browse DB in browser
npx prisma migrate dev        # Create + apply dev migration
npx prisma migrate dev --create-only  # Create migration without applying
npx prisma migrate deploy     # Apply pending migrations (production)
npx prisma db push            # Push schema without migration (prototyping)
npx prisma generate           # Regenerate Prisma client
npm run db:seed               # Seed billing plans
npm run db:setup              # Reset + push schema (for test DBs)
```

### Schema Overview

The schema has **60 models** across these categories:

- **Auth & Users:** User, Account, Session, ApiKey, PasswordResetToken, RefreshToken
- **Workspaces:** Workspace, WorkspaceMember, WorkspaceInvitation
- **Projects:** Project, ProjectSection, ProjectMember, Sprint, ProjectMilestone, ProjectView, ProjectFavorite
- **Tasks:** Task, TaskAssignee, TaskDependency, TaskRecurrence, DailyTask
- **Collaboration:** Comment, CommentMention, Label, TaskLabel, File, UploadRateLimit
- **Calendar & Wellness:** FocusSession, TimeEntry, UserCapacity, UserWorkSchedule, CalendarDayAggregate, GoalCheckpoint, EnergyLevel, WellnessRecommendation, BurnoutSignal
- **Billing:** Plan, Subscription, Invoice, Payment, UsageRecord, BillingEvent
- **Notifications:** Notification, Activity
- **Integrations:** Integration
- **CMS & Content:** PopularResource, ProductUpdate, ContactMessage, JobPosting, TemplateList, ProjectTemplate, SubscribeList
- **Feature Requests:** FeatureRequest, FeatureVote
- **AI:** AiUsageLog

---

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with hot reload (port 5000) |
| `npm run build` | TypeScript compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run lint` | ESLint across `.js/.ts/.tsx` |
| `npm test` | Full test suite |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:coverage` | Coverage report |
| `npx prisma studio` | Browse DB in browser |
| `npx prisma migrate dev` | Create + apply migration |
| `npm run db:seed` | Seed billing plans |
| `npm run db:setup` | Reset schema (test DBs) |
| `npm run sync:contracts` | Sync frontend API contracts |
| `node scripts/generate-keys.js` | Generate RSA key pair |
| `docker-compose up -d` | Start Postgres + Redis |

---

## Troubleshooting

### Port already in use

```bash
# Find process using port 5000
netstat -ano | findstr :5000
# Kill it
taskkill /PID <pid> /F
```

### Database connection refused

1. Make sure Postgres is running: `docker-compose up -d` or check your local Postgres service
2. Verify `DATABASE_URL` in `.env` matches your Postgres credentials and port
3. Check the database exists: `psql -U postgres -c "\l"`

### Redis connection refused

1. Make sure Redis is running: `docker-compose up -d` or check your local Redis service
2. Verify `REDIS_URL` in `.env`

### Prisma client not generated

```bash
npx prisma generate
```

### HMAC verification failed

`NEXTAUTH_SECRET` in `.env` must match the frontend's `NEXTAUTH_SECRET`. Generate one with:

```bash
openssl rand -base64 32
```

### Test failures about "prepared statement already exists"

Tests use `singleFork: true` in vitest config to prevent this. If it still occurs, make sure you're not running multiple test processes simultaneously.

### RSA key errors

Generate keys if you haven't:

```bash
node scripts/generate-keys.js
```

Ensure `keys/private.pem` and `keys/public.pem` exist and are not corrupted.

### Slow queries in development

The Prisma client logs slow queries (>80% of timeout). Check your `QUERY_TIMEOUT_MS` setting (default 30s) and ensure proper database indexes.

---

## Key Concepts

### Authentication Flow

1. Frontend (NextAuth) authenticates the user
2. Frontend calls `POST /api/v1/auth/exchange` with an HMAC-signed proof
3. Backend verifies the proof and issues RS256 token pair (access: 15min, refresh: 7 days)
4. Access token used for API calls via `Authorization: Bearer <token>`
5. Refresh token rotated on every use, stored in Redis

### CSRF Protection

All mutating routes require:
1. `GET /api/v1/csrf-token` to obtain a token (stored in Redis, 30-min TTL)
2. Send it as `X-CSRF-Token` header on every mutating request

**Exempt:** GET requests, SSE stream, auth endpoints, billing webhooks.

### Role-Based Access Control (RBAC)

5 roles: `OWNER`, `ADMIN`, `MEMBER`, `GUEST` (workspace-scoped) + `ADMIN` (platform-wide).

18 granular permissions across workspace, project, task, and billing domains.

### Real-Time Notifications (SSE)

```
Frontend connects to: GET /api/v1/notifications/stream?token=<sseToken>
```

- Single-use, 30-second SSE token (not the access token)
- Redis pub/sub for fan-out across instances
- 5 connections per user, 25s heartbeat
- Auto-reconnects on disconnect

### Payment Providers

Three providers via a provider abstraction:

| Provider | Env var value | Default |
|----------|--------------|---------|
| Lemon Squeezy | `lemonsqueezy` | Yes |
| Stripe | `stripe` | — |
| Paddle | `paddle` | — |

Set `PAYMENT_PROVIDER` in `.env` to switch. No code changes needed.

### Caching

Read-heavy endpoints cached in Redis via `CacheClient`:
- Workspace metadata: 1 hour
- Analytics: 1 hour
- Storage overview: 1 minute
- Labels: 30 minutes

Cache invalidation is called automatically from mutations.

### Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Task reminders | Every 5 min | Notifies before due date |
| Overdue alerts | Every 5 min | Notifies after due date |
| Notification cleanup | Daily 3 AM | Deletes old read notifications |
| Daily task reset | Daily | Resets daily task lists |
| Wellness monitoring | Daily 6 AM | Generates wellness recommendations |
| Burnout signals | Weekly Monday 7 AM | Computes burnout risk |
| Task recurrence | Daily 1 AM | Generates recurring task instances |

---

## Further Reading

- [README.md](./README.md) — Full project overview, API reference, endpoint tables
- [AUTHENTICATION.md](./AUTHENTICATION.md) — Complete auth architecture
- [DEPLOYMENT.MD](./DEPLOYMENT.MD) — Production deployment guide
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guidelines
- [openapi.yaml](./openapi.yaml) — OpenAPI 3.0 specification

---

**Last updated:** September 2026
