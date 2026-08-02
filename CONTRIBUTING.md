# 🤝 Contributing to Focura Backend

Thank you for your interest in contributing to **Focura Backend** — the Express API and business-logic layer powering Focura, a focused, workspace-based productivity SaaS.

This guide reflects how the repository actually works today (stack, module architecture, setup, test conventions, and review process). Please read it fully before opening a pull request.

---

## 📌 Before You Contribute

Please make sure you have read:

- [`README.md`](./README.md) — setup, endpoints, cron jobs, and deployment
- [`AUTHENTICATION.md`](./AUTHENTICATION.md) — JWT, CSRF, sessions, and security architecture
- [`BACKEND_ANALYSIS.md`](./BACKEND_ANALYSIS.md) — codebase analysis
- [`DEPLOYMENT.MD`](./DEPLOYMENT.MD) — how the service is deployed
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — our community standards

---

## 🧭 What You Can Contribute

### ✅ Code Contributions
- Bug fixes
- API endpoint additions or improvements
- Performance / query optimizations
- New cron jobs or queue workers
- Refactoring (without changing behavior)
- Security hardening

### 📝 Documentation
- Improve `README.md` endpoint tables or module docs
- Fix typos or unclear explanations

### 🧪 Testing
- Unit tests (`src/tests/unit/`)
- Integration tests (`src/tests/integrations/`)
- Contract tests (`src/tests/contracts/`)

### 🚫 Please Avoid
- Large architectural changes without prior discussion (open an issue first)
- Breaking existing API contracts consumed by the frontend
- Changing auth/security middleware without an explicit review
- Adding heavy dependencies without justification

---

## 🛠 Tech Stack (what you'll be working with)

| Category | Technology |
|----------|-----------|
| Runtime | Node.js 20+ (ESM — `"type": "module"`) |
| Framework | Express 5 |
| Language | TypeScript 5.9 (compiled with `tsc`) |
| Database | PostgreSQL 16 via Prisma 5.22 |
| Redis | ioredis (pub/sub) + Upstash REST (caching, rate limiting, CSRF) |
| Background jobs | BullMQ (6 queues) |
| Cron | node-cron |
| Validation | Zod 4 |
| Payments | Stripe + Paddle (provider abstraction) |
| Errors/tracing | Sentry |
| Tests | Vitest 3 + Supertest + MSW + @faker-js/faker |

---

## 🚀 Development Setup

> **Prerequisites:** Node.js 20+, PostgreSQL 16, and Redis 7 running locally. If you don't want to install them directly, start them with the provided `docker-compose.yml` (`docker-compose up -d`) or run Postgres/Redis on their default ports.

1. **Fork** the repository and clone your fork:
```bash
git clone https://github.com/gaziraihan1/focura-backend.git
cd focura-backend
```

2. **Install dependencies** (runs `prisma generate` via `postinstall`):
```bash
npm install
```

3. **Create environment files:**
```bash
cp .env.example .env
cp .env.example .env.test    # tests use TEST_DATABASE_URL (see below)
```
At minimum, set in `.env`:
```env
DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/focura_dev
NEXTAUTH_SECRET=<must-match-the-frontend's-NEXTAUTH_SECRET>
CLIENT_URL=http://localhost:3000
```
Redis / Stripe / Cloudinary / email keys are only needed when working on those features.

4. **Generate the RSA key pair** (first time only — `keys/` is gitignored):
```bash
node scripts/generate-keys.js
```

5. **Apply migrations and seed:**
```bash
npx prisma migrate dev
npm run db:seed
```

6. **Run the server** (nodemon + tsx, port 5000):
```bash
npm run dev
```

### Useful Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with hot reload (port 5000) |
| `npm run build` | TypeScript compile to `dist/` |
| `npm start` | Run the compiled `dist/index.js` |
| `npm run lint` | ESLint across `.js/.ts/.tsx` |
| `npm test` | Run the full suite (unit + integration + contracts + e2e) |
| `npm run test:unit` | Unit tests only (`src/tests/unit`) |
| `npm run test:integration` | Integration tests only (`src/tests/integrations`) |
| `npm run test:coverage` | Coverage (thresholds: 70% lines / 70% functions / 60% branches) |
| `npm run prisma:migrate` | Create + apply a dev migration (`prisma migrate dev`) |
| `npm run prisma:migrate:create` | Create migration without applying (`--create-only`) |
| `npm run prisma:studio` | Browse the DB with Prisma Studio |
| `npm run db:setup` | `prisma generate` + `prisma db push --force-reset` (test DBs) |
| `npm run db:seed` | Seed the database (`prisma/seed.ts`) |

---

## 🌱 Branching Strategy

The backend uses a **single long-lived branch**:

- `main` → stable, production-ready (deployed via `npm run deploy`)

Feature branches:

```
feature/your-feature-name
fix/bug-description
refactor/area-name
chore/task
```

**Always branch from `main`** and open pull requests **against `main`**. Keep branches focused on a single concern.

---

## ✅ Commit Guidelines

Use conventional commit messages:

```
feat(calendar): add energy export endpoint
fix(focusSession): invalidate daily-summary cache on cancel
refactor(auth): simplify token refresh lock
test(wellness): cover dismiss-all service path
docs: document burnout signal cron
chore: bump prisma
```

---

## 🏗 Architecture (read this before writing code)

The backend is a **modular monolith**. Each domain lives in `src/modules/<domain>/` and is fully self-contained:

```
src/modules/<domain>/
├── <domain>.routes.ts       # route registration only
├── <domain>.controller.ts   # request/response handling — thin layer
├── <domain>.query.ts        # read operations (uses prismaRead)
├── <domain>.mutation.ts     # write operations (uses prisma — primary)
├── <domain>.selects.ts      # reusable Prisma select/include objects
├── <domain>.types.ts        # TypeScript types/interfaces
├── <domain>.access.ts       # permission/access checks
├── <domain>.validators.ts   # Zod input validation
├── <domain>.activity.ts     # activity feed logging
├── <domain>.notifications.ts# notification dispatch
├── <domain>.filters.ts      # query filtering logic
├── <domain>.analytics.ts    # stats/analytics logic
├── <domain>.cron.ts         # scheduled jobs
├── <domain>.service.ts      # business logic (some modules)
└── index.ts                 # module barrel export
```

### Non-negotiable rules

- **Controllers are thin** — they validate, call a query/mutation, and return. No raw Prisma in controllers.
- **Queries use `prismaRead`** (replica) for read-heavy paths; **mutations always use `prisma`** (primary).
- **Validate every input with Zod** in `<domain>.validators.ts` — never trust client data.
- **Use the error system:** throw `AppError` subclasses (or the `asyncHandler` wrapper) so the centralized `errorHandler` returns consistent responses.
- **Workspace-safe queries** — every cross-workspace lookup must be scoped by membership/role (see `<domain>.access.ts` and existing RBAC patterns).
- **Invalidate caches from mutations** via `lib/redis/cache.client.ts` helpers (e.g. `CalendarCache.invalidateEnergy(userId)`). Cache keys live in `CACHE_KEYS`.
- **Cross-module notification dispatch** goes through `modules/notification/notification.helpers.ts` (`notifyUser`, `notifyTaskAssignees`, …).

### Adding a new endpoint

1. Add a Zod schema in `<domain>.validators.ts`
2. Implement the read/write in `<domain>.query.ts` / `<domain>.mutation.ts` (with cache handling)
3. Wire the controller handler + route in `<domain>.routes.ts`
4. Export through `<domain>/index.ts`; register the router in `src/index.ts` (mount with `authenticate` + `requireCsrfToken()` for mutations)
5. Add tests (unit for logic, integration for the route)

### Adding a cron job

1. Create `<domain>.cron.ts` exporting an `init*Crons()` function (see `wellness.cron.ts` / `burnoutSignal.cron.ts`)
2. Batch-process users (paginate `BATCH_SIZE`, use `Promise.allSettled` so one failure doesn't abort the run)
3. Call the init function in `src/index.ts` next to the other cron inits

### Background jobs

Long-running work goes through BullMQ: define the job type + `add*Job` helper in `src/queue/queues/*.queue.ts`, implement the handler in `src/queue/workers/*.worker.ts`. Workers are registered in `src/queue/index.ts`.

---

## 🧪 Testing Your Changes

Tests run with **Vitest**. The infrastructure is already set up in `vitest.config.ts`:

- `globalSetup` (`src/tests/globalSetup.ts`) — generates a temporary RSA key pair, sets test env vars, **pushes the schema to the test DB** (`prisma db push --force-reset`), and seeds it
- `setup.ts` — runs per worker (per-file mocks, DB cleanup)
- `pool: forks` with `singleFork: true` — prevents PG "prepared statement" conflicts
- `testTimeout: 25000` — integration tests hit a real DB

### Test database

Tests need `.env.test` with a dedicated database:

```env
TEST_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/focura_test
# falls back to DATABASE_URL if TEST_DATABASE_URL is not set — do NOT run tests against your dev DB
```

### Where to put tests

| Test type | Location | Approach |
|-----------|----------|----------|
| Unit | `src/tests/unit/<domain>/*.test.ts` | Mock `prisma` / Redis / external services with `vi.mock`; assert pure logic |
| Integration | `src/tests/integrations/` | Real DB + factories (`src/tests/factories/`) + Supertest |
| Contract | `src/tests/contracts/` | Zod validation of request/response shapes |
| E2E | `src/tests/e2e/` | End-to-end workflows |
| Factories | `src/tests/factories/` | `createUser`, `createWorkspaceWithOwner`, etc. — reuse, don't re-create |
| Helpers | `src/tests/helpers/` | Auth + CSRF test helpers |

**Test patterns to follow:**

- Unit tests mock the module under test's dependencies (see `wellness.cron.test.ts` for the cron-mocking pattern).
- Integration tests use the factories + `cleanAllTestData()` in `beforeEach` (FK-safe cleanup).
- Never leave a test that requires secrets, network access, or Stripe live keys — mock them.

**Run the targeted suite while developing:**
```bash
npm run test:unit -- src/tests/unit/calendar
npx vitest run src/tests/unit/calendar/wellness.service.test.ts
```

**Before submitting:**
- [ ] `npm run lint` passes (no new errors)
- [ ] `npx tsc --noEmit` — no new type errors in your files
- [ ] `npm test` — your tests pass and nothing else broke
- [ ] If you changed `prisma/schema.prisma`: create a migration (`npm run prisma:migrate`) and keep the Prisma client regenerated (`npm run prisma:generate`)

---

## 🔒 Security Rules

- **Never commit secrets** — `.env`, `.env.test`, `keys/private.pem` are gitignored
- **Never log tokens**, passwords, or PII
- Every mutating route needs CSRF protection (`requireCsrfToken()`) unless intentionally public (webhooks, auth)
- Respect workspace/user isolation — verify membership before serving data
- Sanitize all user input (see `lib/security/sanitize.ts`)
- Rate-limit anything user-facing or expensive

---

## 🔁 Pull Request Process

1. Branch from `main`: `git checkout -b feature/your-feature-name main`
2. Make focused commits with conventional messages
3. Push to your fork: `git push origin feature/your-feature-name`
4. Open a **Pull Request against `main`** and describe:
   - What you changed and why
   - How you tested it (commands run, test counts)
   - Whether the change affects the API contract (endpoint tables in `README.md`)
5. Link any related issue

---

## 📋 Pull Request Checklist

- [ ] Code follows the module architecture and rules above
- [ ] Controllers thin; logic in query/mutation/service
- [ ] Zod validation added for any new/updated input
- [ ] Cache keys + invalidation handled for new read paths
- [ ] New/updated tests included and passing (`npm test`)
- [ ] Lint clean (`npm run lint`)
- [ ] Typecheck clean (`npx tsc --noEmit`)
- [ ] Schema changes shipped with a migration
- [ ] No unnecessary dependencies added
- [ ] `README.md` endpoint/cron tables updated if relevant

---

## 🧠 Project Philosophy

Focura values:

- Focus over feature bloat
- Simplicity over complexity
- Quality over quantity
- Intentional productivity

All contributions should align with this mindset.

---

## 👤 Maintainer

All contributions are reviewed by:

**Mohammad Raihan Gazi** — Creator & Maintainer of Focura

Thank you for contributing 🚀
