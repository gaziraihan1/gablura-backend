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















*
📋 CACHING STRATEGY – Weakness‑Recovery Todo List  
(Based on the current CACHING_STRATEGY.md and the code‑base layout)  
Below is a step‑by‑step roadmap that tackles each identified weakness one at a time.  
Each major item is broken into concrete, test‑driven subtasks so you can ship them incrementally without overwhelming the CI pipeline.
---
1️⃣ Task‑List Cache (Highest‑Priority – “high priority” in the doc)
✅ Sub‑task	Description
1.1 Add deterministic key helper	Create hashFilters(filters) that returns an MD5 (or SHA‑256) hash of a sorted JSON representation – prevents key explosion.
1.2 Extend CACHE_KEYS	Add taskList: (filterHash: string) => \task:list:${filterHash}`` (already in the doc, just confirm).
1.3 Implement cache‑aside in query	In src/modules/task/task.query.ts create getTaskList(filters) that: <br>1️⃣ builds the hash, <br>2️⃣ calls CacheClient.getOrSet(key, fetcher, CACHE_TTL.TASK_OVERVIEW) (TTL ≈ 120 s as per doc).
1.4 Add invalidation hook	In src/modules/task/task.mutation.ts after any create / update / delete call, invoke TaskCache.invalidateList() that deletes all keys matching task:list:*.
1.5 Write unit tests	• Verify cache miss → DB query runs. <br>• Verify cache hit → DB is not called. <br>• Verify invalidation clears the key pattern.
1.6 Update CI	Ensure the new tests run in CI (no extra env needed).
1.7 Deploy & monitor	Add a Prometheus counter for task_list_cache_hits / misses. (Optional, can be deferred to later step).
Done → Move to #2  
---
2️⃣ Project‑List Cache (Medium‑priority)
✅ Sub‑task	Description
2.1 Add workspace‑scoped key	In CACHE_KEYS add projectWorkspaceList: (workspaceId: string) => \project:workspace:${workspaceId}``.
2.2 Cache per‑user list (already exists) – keep it, but invalidate on workspace‑wide changes.	 
2.3 Query implementation	In src/modules/project/project.query.ts create getUserProjects(userId, workspaceId?) that uses CacheClient.getOrSet with TTL = 600 s (10 min). Use the new key when workspaceId is supplied.
2.4 Mutation invalidation	In src/modules/project/project.mutation.ts after create / delete / move of a project, call: <br>• ProjectCache.invalidateUserProjects(userId) (existing) <br>• ProjectCache.invalidateWorkspaceProjects(workspaceId) (existing) <br>• NEW ProjectCache.invalidateWorkspaceList(workspaceId) → delete project:workspace:${workspaceId}.
2.5 Unit tests	• Cache hit / miss for per‑user list. <br>• Workspace‑scoped list invalidation when a project is moved.
2.6 Docs update	Add a short entry in CACHING_STRATEGY.md under “Project List Caching Complete”.
2.7 Monitoring (optional)	Add hit/miss metrics similar to task list (can be grouped under a generic “list_cache” metric).
Done → Move to #3  
---
3️⃣ Activity‑Feed Cache (Medium‑priority)
✅ Sub‑task	Description
3.1 Add key	activityFeed: (userId: string, filterHash: string) => \activity:feed:${userId}:${filterHash}`inCACHE_KEYS`.
3.2 Normalise filter → hash (reuse hashFilters).	 
3.3 Query implementation	In src/modules/activity/activity.query.ts add getFeed(userId, filters) using CacheClient.getOrSet with TTL = 30 s (as per table).
3.4 Invalidate on write	In src/modules/activity/activity.mutation.ts after a new activity is inserted, call ActivityCache.invalidateFeed(userId) (or pattern delete activity:feed:${userId}:*).
3.5 Unit tests	• Verify short TTL caching works. <br>• Verify that a new activity clears the feed.
3.6 Performance check	Run a quick local load script (npm run test:performance – optional) to confirm DB queries drop dramatically.
3.7 Add metric	activity_feed_cache_hits / misses.
Done → Move to #4  
---
4️⃣ Calendar‑Aggregates Cache (Medium‑priority)
✅ Sub‑task
4.1 Add key
4.2 Query implementation
4.3 Invalidate on event CRUD
4.4 Unit tests
4.5 Add to docs** – note the “Calendar Aggregates Cached”.
4.6 Metric** – optional calendar_agg_cache_hits.
Done → Move to #5  
---
5️⃣ User‑Session Cache Invalidation Race (Low‑priority)
✅ Sub‑task
5.1 Identify current invalidation
5.2 Replace with atomic operation
5.3 Update SessionCache.invalidate(userId, sessionId) method to use the atomic call.
5.4 Add a fallback lock (e.g., SETNX with a short TTL) if GETDEL isn’t available on the hosted Upstash instance.
5.5 Unit test – simulate concurrent read & logout, assert that after logout the session is never returned.
5.6 Add docs entry “User‑Session race condition fixed”.
5.7 (Optional) Add a log counter for how many times the race is detected.
Done → Move to #6  
---
6️⃣ Cache‑Key Explosion Mitigation (Medium‑priority)
✅ Sub‑task
6.1 Create utility src/lib/redis/cacheKeyHash.ts that: <br>• Sorts object keys, <br>• JSON‑stringifies, <br>• Returns a short hex hash (MD5/SHA‑256).
6.2 Refactor all existing key generators that accept raw query strings (taskList(filters), activityFeed(userId, filters), etc.) to call hashFilters(filters) first.
6.3 Add unit tests for the utility (different order of keys → same hash).
6.4 Update docs – mention that keys are now hash‑based to avoid cardinality explosion.
6.5 Add a monitor that logs the number of distinct keys created per minute (use Redis SCAN and metric).
Done → Move to #7  
---
7️⃣ Cache‑Hit / Miss Metrics (Low‑priority)
✅ Sub‑task
7.1 Add a thin wrapper around CacheClient.get / set that increments Prometheus counters: cache_hits_total and cache_misses_total with label domain (e.g., task, project, activity).
7.2 Export these metrics via the existing metrics endpoint (/metrics).
7.3 Validate locally (`curl localhost:5001/metrics
7.4 Update CI to ensure the metrics library is installed (prom-client is already a dev‑dependency in many projects).
7.5 Document in CACHING_STRATEGY.md the new observability data.
Done → Move to #8  
---
8️⃣ Cross‑Instance Pub/Sub Invalidation (Medium‑priority)
✅ Sub‑task
8.1 Define a Redis channel cache:invalidate.
8.2 In every cache invalidation helper (e.g., TaskCache.invalidateList, ProjectCache.invalidateWorkspaceProjects, ActivityCache.invalidateFeed) publish a JSON payload: {domain: "task", pattern: "task:list:*"}.
8.3 Add a background subscriber (Node process started on app boot) that listens on that channel and executes CacheClient.deletePattern(pattern).
8.4 Ensure the subscriber runs once per instance (singleton via once or a dedicated module).
8.5 Unit test – mock Redis Pub/Sub and verify that a publish results in a deletePattern call on another “instance” (use vi.mock).
8.6 Add env flag CACHE_PUBSUB_ENABLED=true (default true in CI).
8.7 Document the pattern in the strategy doc under “Pub/Sub Invalidation”.
Done → Move to #9  
---
9️⃣ L1 In‑Process Cache (Optional – Performance polish)
✅ Sub‑task
9.1 Choose a tiny in‑process cache library (e.g., node-cache already a dev‑dependency).
9.2 Wrap CacheClient.getOrSet with an L1 layer that checks the in‑process map first (TTL ≈ same as Redis TTL).
9.3 Activate only for ultra‑hot keys: userProfile, authResult, maybe taskById.
9.4 Add unit tests confirming L1 → L2 fallback works.
9.5 Add benchmark script to compare latency (optional).
9.6 Document usage and config switch (CACHE_L1_ENABLED).
Done → All major weaknesses addressed.
---
📆 Suggested Roll‑out Timeline
Sprint	Focus
Sprint 1	Implement Task‑List cache (steps 1.1 – 1.7).
Sprint 2	Project‑List cache (steps 2.1 – 2.7).
Sprint 3	Activity‑Feed cache (steps 3.1 – 3.7).
Sprint 4	Calendar‑Aggregates cache (steps 4.1 – 4.6).
Sprint 5	Fix User‑Session race, add Key‑hash utility, start metrics.
Sprint 6	Deploy Pub/Sub invalidation; optional L1 cache if latency budget still high.
Each sprint ends with CI green and a metrics dashboard showing cache‑hit ratios for the newly‑added domain.
---
📚 Quick Reference – Updated CACHE_KEYS (after all tasks)
export const CACHE_KEYS = {
  // Workspace
  workspaceById: (id: string) => `workspace:id:${id}`,
  workspaceBySlug: (slug: string) => `workspace:slug:${slug}`,
  workspaceStats: (id: string) => `workspace:stats:${id}`,
  // Project
  projectById: (id: string) => `project:id:${id}`,
  projectBySlug: (slug: string) => `project:slug:${slug}`,
  projectList: (userId: string, wsId?: string) => `project:list:${userId}:${wsId ?? 'all'}`,
  projectWorkspaceList: (workspaceId: string) => `project:workspace:${workspaceId}`,
  // Task
  taskById: (id: string) => `task:id:${id}`,
  taskList: (filterHash: string) => `task:list:${filterHash}`,
  // Activity
  activityFeed: (userId: string, filterHash: string) => `activity:feed:${userId}:${filterHash}`,
  activityTaskList: (taskId: string) => `activity:task:${taskId}`,
  // Calendar
  calendarAggregates: (workspaceId: string, filterHash: string) =>
    `calendar:aggregates:${workspaceId}:${filterHash}`,
  // Focus Session, User, External API, etc. – unchanged
  focusActiveSession: (userId: string) => `focus:active:${userId}`,
  userProfile: (userId: string) => `user:profile:${userId}`,
  // …
};
---
🎉 What you get after completing the list
* Huge DB load reduction (task list, project list, activity feed, calendar aggregates).  
* Predictable cache keys → no memory‑pressure from key explosion.  
* Observability – hit/miss metrics and Prometheus/Sentry dashboards.  
* Consistency across multiple pods via Pub/Sub invalidation.  
* Race‑free session handling and a fast‑path L1 cache for the hottest look‑ups.  
* Documentation updates that keep the team aligned.
Feel free to adjust the order to match your current sprint capacity—just remember don’t try to do everything at once; take the items in the exact sequence above and you’ll see incremental performance gains after each deployment. Good luck! 🚀