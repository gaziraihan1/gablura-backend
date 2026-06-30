# Caching Strategy Overview for Focura Backend

## 1. Purpose
The caching layer is used to reduce load on the PostgreSQL database and external APIs, improve latency for read‑heavy endpoints, and protect the system from hot‑spot traffic.  The implementation relies on **Redis (Upstash)** as a central cache store with a **cache‑aside** pattern.

## 2. Core Infrastructure
### 2.1 `CacheClient`
Located at `src/lib/redis/cache.client.ts`, it provides a thin wrapper around the Redis client with typed helpers:
- `get<T>(key)` – fetch a value.
- `set(key, value, ttl?)` – store a value with optional TTL.
- `getOrSet<T>(key, fetcher, ttl)` – cache‑aside helper used throughout the codebase.
- `delete(...keys)` and `deletePattern(pattern)` – removal utilities.

### 2.2 TTL Configuration (`CACHE_TTL`)
TTL values are defined in seconds and can be overridden with environment variables.  Highlights:

| Domain | TTL (s) | Rationale |
|--------|---------|-----------|
| `WORKSPACE_METADATA` | 3600 (1 h) | Workspace data changes rarely. |
| `LABEL_LIST` | 1800 (30 min) | |
| `PROJECT_METADATA` | 1800 (30 min) | |
| `PROJECT_LIST` | 600 (10 min) | |
| `TASK_METADATA` | 300 (5 min) | Tasks are frequently updated. |
| `TASK_STATS` | 120 (2 min) | |
| `ACTIVITY_FEED` | 30 (30 s) | Real‑time activity updates. |
| `CALENDAR_AGGREGATES` | 300 (5 min) | |
| `FOCUS_ACTIVE_SESSION` | 30 (30 s) | |
| `ANALYTICS_KPI` | 1800 (30 min) | |

### 2.3 Cache Key Registry (`CACHE_KEYS`)
All cache keys are generated centrally. Example groups (partial list):

```ts
export const CACHE_KEYS = {
  // Workspace
  workspaceById: (id: string) => `workspace:id:${id}`,
  workspaceBySlug: (slug: string) => `workspace:slug:${slug}`,
  workspaceStats: (id: string) => `workspace:stats:${id}`,
  // Project
  projectById: (id: string) => `project:id:${id}`,
  projectBySlug: (slug: string) => `project:slug:${slug}`,
  projectList: (userId: string, wsId?: string) => `project:list:${userId}:${wsId ?? 'all'}`,
  // Task
  taskById: (id: string) => `task:id:${id}`,
  taskList: (filters: string) => `task:list:${filters}`,
  // Activity
  activityFeed: (userId: string, filters: string) => `activity:feed:${userId}:${filters}`,
  // Focus Session
  focusActiveSession: (userId: string) => `focus:active:${userId}`,
  // User
  userProfile: (userId: string) => `user:profile:${userId}`,
  userSettings: (userId: string) => `user:settings:${userId}`,
  // External API
  stripeCustomer: (id: string) => `api:stripe:customer:${id}`,
  // …many more
};
```
All keys are **prefixed** with the domain to avoid collisions and to enable pattern‑based invalidation.

## 3. Current Module‑Level Caching

| Module | Cached Objects | Where Cached | Invalidation Hooks |
|--------|----------------|--------------|--------------------|
| **Workspace** | metadata, members, stats, overview | `src/modules/workspace/*.query.ts` | Mutations call `WorkspaceCache.invalidate*` in `workspace.mutation.ts` |
| **Label** | label list, individual label, popular labels | `src/modules/label/label.query.ts` | `LabelCache.invalidate*` in `label.mutation.ts` |
| **Analytics** | dashboard, KPI, trends, member metrics, project health | `src/modules/analytics/*.query.ts` | Invalidation occurs on updates to related resources (tasks, projects) via `AnalyticsCache.invalidate*` |
| **Storage** | workspace summary, overview, info, user contributions, largest files | `src/modules/storage/*.query.ts` | `StorageCache.invalidate*` called from storage mutations |
| **Project** | project metadata, list, stats, by‑slug | `src/modules/project/project.query.ts` | `ProjectCache.invalidate*` executed in `project.mutation.ts` |
| **Task** | **Only** `taskStats` (2‑min TTL) is cached | `src/modules/task/task.query.ts` (stats) | `TaskCache.invalidateStats` used in task mutations |
| **Activity** | **None** – feeds are read‑only and hit DB every request | – | – |
| **Calendar** | **None** – aggregates and insights are recomputed on demand | – | – |
| **Focus Session** | active session, history, stats, streak | `src/modules/focusSession/focusSession.query.ts` | `FocusSessionCache.invalidate*` in mutations |
| **User** | profile, settings, permissions, session, active‑sessions, auth result | `src/lib/auth/*` and various queries | `UserCache.invalidate*` helpers used on profile updates, permission changes, logout |
| **External APIs** | Stripe customer/subscription/price, Paddle equivalents | `src/lib/external/*` | `ExternalApiCache.invalidate*` called after webhook updates |

## 4. Strengths (What Works Well)
- **Consistent Cache‑Aside Helper** (`CacheClient.getOrSet`) is used across most read‑heavy modules, guaranteeing a single source of truth for TTL handling.
- **Granular Invalidation** – each domain has its own *Cache* object exposing targeted `invalidate*` methods, reducing unnecessary deletions.
- **TTL Diversity** – short TTLs for rapidly changing data (focus session, activity) and longer TTLs for relatively static data (project metadata) balance freshness vs. cache churn.
- **Pattern‑based Deletion** – e.g., `deletePattern('user:permissions:${userId}:*')` efficiently clears all permission entries.
- **External API Caching** – Stripe/Paddle objects are cached, preventing rate‑limit hits.

## 5. Weaknesses \u0026 Missing Coverage (Minus Points)

| Issue | Impact | Suggested Fix |
|-------|--------|--------------|
| **Task List Not Cached** | Task list endpoints (`GET /tasks`) are the most frequent calls. Missing cache leads to high DB load. | Introduce `taskList` key (`CACHE_KEYS.taskList(filters)`) with TTL 2 min and use `CacheClient.getOrSet` in `task.query.ts`. |
| **Project List Caching Incomplete** | Only individual project details are cached; the per‑user project list is cached but lacks a *workspace‑scoped* variant. | Add `projectWorkspaceList` key and invalidate on project create/delete/move. |
| **Activity Feed Missing** | Real‑time feeds are read‑only; no caching causes repeated scans of the `activity` table. | Cache feed results (`CACHE_KEYS.activityFeed(userId, filters)`) with a 30‑second TTL; invalidate on new activity via `ActivityCache.invalidateFeed`. |
| **Calendar Aggregates Not Cached** | Calendar dashboards recompute on every request, increasing DB load. | Add keys (`calendarAggregates`, `calendarInsights`) with 5‑minute TTL; invalidate on event create/update/delete. |
| **User Session Cache Invalidation Race** | `invalidateSession` is called on logout, but any concurrent request may still read a stale session entry before deletion. | Use Redis **SETNX** lock or atomic `GETDEL` to ensure the session is removed before any further reads. |
| **Cache‑Key Explosion** | Many keys are generated with raw query strings (`taskList(filters)`). When filters contain many parameters, key cardinality explodes, causing memory pressure. | Normalise filter objects to a deterministic, short representation (e.g., sorted JSON string or hash) before building the key. |
| **Missing Cache‑Hit Metrics** | No built‑in monitoring of hit/miss ratios, making it hard to quantify impact. | Wrap `CacheClient.get`/`set` with counters stored in a Prometheus gauge or Sentry metric. |
| **No Pub/Sub Invalidation Across Instances** | In a multi‑instance deployment, a cache invalidation performed on one pod does not automatically propagate to others. | Use Redis **pub/sub** channel (e.g., `cache:invalidate`) to broadcast invalidation events; each instance listens and clears its local copy. |
| **Stale Data Window** | Some TTLs (e.g., `PROJECT_METADATA` 30 min) may allow noticeably stale data for high‑frequency UI components. | Consider **soft‑expiration**: serve stale data while a background refresh populates a fresh entry. |
| **Lack of L1 In‑Process Cache** | Every request hits Redis even for hot keys, adding network round‑trip latency (~1 ms). | Introduce a tiny L1 cache (e.g., `node-cache`) for ultra‑hot keys like `userProfile` and `authResult`. |

## 6. Recommendations \u0026 Roadmap
1. **Task Module – Full Cache‑Aside** (high priority) – add list, by‑id, and assignee/label sub‑keys; invalidate on task mutation.
2. **Activity Module – Feed Cache** (medium) – 30‑second TTL, append‑only invalidation on new activity.
3. **Calendar Module – Aggregates Cache** (medium) – 5‑minute TTL, invalidate on event CRUD.
4. **User Session Race‑Condition Fix** (low) – atomic delete or lock.
5. **Key Normalisation Utility** – central helper to hash filter objects before key generation.
6. **Metrics Integration** – expose hit/miss counters via Prometheus or Sentry.
7. **Pub/Sub Invalidation** – implement a `cache:invalidate` channel for multi‑instance consistency.
8. **L1 In‑Process Cache** – optional fast‑path for ultra‑hot entries.

## 7. Example: Adding a New Cache Entry (Task List)
```ts
// src/lib/redis/cache.client.ts – add key generator
export const CACHE_KEYS = {
  // …existing keys
  taskList: (filterHash: string) => `task:list:${filterHash}`,
};

// src/modules/task/task.query.ts – use cache‑aside
import { createHash } from 'crypto';

function hashFilters(filters: Record<string, any>): string {
  return createHash('md5').update(JSON.stringify(filters)).digest('hex');
}

export const TaskQuery = {
  async getTaskList(filters) {
    const key = CACHE_KEYS.taskList(hashFilters(filters));
    return CacheClient.getOrSet(key, async () => {
      // original DB query here
      return prisma.task.findMany({ where: filters, orderBy: { createdAt: 'desc' } });
    }, CACHE_TTL.TASK_OVERVIEW);
  },
};

// src/modules/task/task.mutation.ts – invalidate on any write
export const TaskMutation = {
  async createTask(...args) {
    const task = await prisma.task.create({ data: args[0] });
    await TaskCache.invalidateList(); // clears all task:list:* keys
    return task;
  },
  // similar for update/delete
};
```

## 8. Summary
The Focura backend already possesses a solid Redis‑based caching foundation with TTLs tuned per domain and well‑structured invalidation helpers.  The major gaps are **task list caching**, **activity \u0026 calendar feeds**, and **cross‑instance invalidation**.  Addressing these, together with adding metrics and a lightweight L1 cache, will dramatically lower database traffic, improve response times, and make the system more resilient under load.