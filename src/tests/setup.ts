import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { clearFactoryCaches } from './factories/index.js';

process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL   = process.env.TEST_DATABASE_URL;
}

// ── MOCK: node-cron ───────────────────────────────────────────────────────────
vi.mock('node-cron', () => ({
  default:  { schedule: vi.fn() },
  schedule: vi.fn(),
}));

// ── MOCK: ioredis ─────────────────────────────────────────────────────────────
const redisStore = new Map<string, string>();

const redisSetStore = new Map<string, Set<string>>();

const createInMemoryRedisMock = () => {
  const mock = {
    get:    vi.fn(async (key: string) => redisStore.get(key) ?? null),
    exists:   vi.fn(async (key: string) => redisStore.has(key) ? 1 : 0),
    set:    vi.fn(async (key: string, value: string) => { redisStore.set(key, value); return 'OK'; }),
    setex:  vi.fn(async (key: string, _ttl: number, value: string) => { redisStore.set(key, value); return 'OK'; }),
    del:    vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        // A key can live in the string store, the set store, or both.
        deleted += redisStore.delete(key) ? 1 : 0;
        deleted += redisSetStore.delete(key) ? 1 : 0;
      }
      return deleted;
    }),
    keys:   vi.fn(async (pattern: string) => {
      if (!pattern.includes('*')) return redisStore.has(pattern) ? [pattern] : [];
      const regex = new RegExp(`^${pattern.replaceAll('*', '.*')}$`);
      return [...redisStore.keys()].filter((k) => regex.test(k));
    }),
    decr:   vi.fn().mockResolvedValue(0),
    incr:   vi.fn().mockResolvedValue(1),
    incrby: vi.fn(async (key: string, n: number) => {
      const cur = parseInt(redisStore.get(key) ?? '0', 10);
      const next = cur + n;
      redisStore.set(key, String(next));
      return next;
    }),
    decrby: vi.fn(async (key: string, n: number) => {
      const cur = parseInt(redisStore.get(key) ?? '0', 10);
      const next = Math.max(0, cur + n);
      redisStore.set(key, String(next));
      return next;
    }),
    zrem:   vi.fn().mockResolvedValue(1),
    zcard:  vi.fn().mockResolvedValue(0),
    zadd:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    sadd:   vi.fn(async (key: string, member: string) => {
      if (!redisSetStore.has(key)) redisSetStore.set(key, new Set());
      redisSetStore.get(key)!.add(member);
      return 1;
    }),
    srem:   vi.fn(async (key: string, member: string) => {
      const set = redisSetStore.get(key);
      if (!set) return 0;
      const had = set.delete(member);
      if (set.size === 0) redisSetStore.delete(key);
      return had ? 1 : 0;
    }),
    smembers: vi.fn(async (key: string) => [...(redisSetStore.get(key) ?? [])]),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    eval:   vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue({
      get:              vi.fn().mockReturnThis(),
      set:              vi.fn().mockReturnThis(),
      zadd:             vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      zremrangebyscore: vi.fn().mockReturnThis(),
      expire:           vi.fn().mockReturnThis(),
      incr:             vi.fn().mockReturnThis(),
      exec:             vi.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
    }),
    on:     vi.fn().mockReturnThis(),
    publish:   vi.fn().mockResolvedValue('OK'),
    quit:   vi.fn().mockResolvedValue('OK'),
    status: 'ready',
  };
  return mock;
};

const RedisMock = vi.fn().mockImplementation(() => createInMemoryRedisMock());

vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis:   RedisMock,
}));

// ── MOCK: @upstash/redis (only used by contactRateLimit + templates) ───────────
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => createInMemoryRedisMock()),
}));

// ── MOCK: @upstash/ratelimit ──────────────────────────────────────────────────
vi.mock('@upstash/ratelimit', () => {
  const RatelimitMock = vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockResolvedValue({
      success: true,
      remaining: 99,
      reset: Date.now() + 60_000,
    }),
  })) as unknown as typeof import('@upstash/ratelimit').Ratelimit & {
    slidingWindow: ReturnType<typeof vi.fn>;
    fixedWindow:   ReturnType<typeof vi.fn>;
    tokenBucket:   ReturnType<typeof vi.fn>;
  };

  (RatelimitMock as any).slidingWindow = vi.fn().mockReturnValue("mocked-limiter");
  (RatelimitMock as any).fixedWindow   = vi.fn().mockReturnValue("mocked-limiter");
  (RatelimitMock as any).tokenBucket   = vi.fn().mockReturnValue("mocked-limiter");

  return { Ratelimit: RatelimitMock };
});

// ── MOCK: redis/redis.client.ts ───────────────────────────────────────────
const noopRedisClient = createInMemoryRedisMock();

vi.mock('../redis/redis.client.js', () => ({
  getRedisClient: vi.fn(() => noopRedisClient),
  BILLING_CACHE: {
    getSubscription:     vi.fn().mockResolvedValue(null),
    setSubscription:     vi.fn().mockResolvedValue(undefined),
    getPlanLimits:       vi.fn().mockResolvedValue(null),
    setPlanLimits:       vi.fn().mockResolvedValue(undefined),
    getUserWsLimit:      vi.fn().mockResolvedValue(null),
    setUserWsLimit:      vi.fn().mockResolvedValue(undefined),
    invalidateWorkspace: vi.fn().mockResolvedValue(undefined),
    invoiceKey:          vi.fn().mockReturnValue('invoice:test'),
    INVOICE_TTL:         300,
  },
}));

// ── MOCK: lib/redis.ts (shim — only used by Upstash ratelimit files) ──────────
vi.mock('../lib/redis.js', () => ({
  redis: createInMemoryRedisMock(),
}));

// ── MOCK: tokenRevocation ─────────────────────────────────────────────────────
vi.mock('../lib/auth/tokenRevocation.js', () => ({
  isAccessTokenRevoked:   vi.fn().mockResolvedValue(false),
  isSessionRevoked:       vi.fn().mockResolvedValue(false),
  markSessionRevoked:     vi.fn().mockResolvedValue(undefined),
  revokeAccessToken:      vi.fn().mockResolvedValue(undefined),
  revokeAllRefreshTokens: vi.fn().mockResolvedValue(undefined),
  storeRefreshToken:      vi.fn().mockResolvedValue(undefined),
  rotateRefreshToken:     vi.fn().mockResolvedValue(true),
}));

// ── MOCK: refreshLock ─────────────────────────────────────────────────────────
vi.mock('../lib/auth/refreshLock.js', () => ({
  acquireRefreshLock: vi.fn().mockResolvedValue(true),
  releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
  isRefreshLocked:    vi.fn().mockResolvedValue(false),
}));

// ── MOCK: Cloudinary ──────────────────────────────────────────────────────────
vi.mock('cloudinary', () => ({
  v2: {
    config:   vi.fn(),
    uploader: {
      upload:  vi.fn().mockResolvedValue({
        secure_url:    'https://cdn.test/img.png',
        public_id:     'test_id',
        bytes:         12345,
        format:        'txt',
        thumbnail_url: 'https://cdn.test/img_thumb.png',
      }),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

// ── MOCK: Stripe ──────────────────────────────────────────────────────────────
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    customers:     { create: vi.fn(), retrieve: vi.fn() },
    subscriptions: { create: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    checkout:      { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }) } },
    billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }) } },
    webhooks:      { constructEvent: vi.fn() },
  })),
}));

// ── MOCK: bullmq ───────────────────────────────────────────────────────────────
vi.mock('bullmq', () => {
  const mockAdd = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
  const mockClose = vi.fn().mockResolvedValue(undefined);

  class MockQueue {
    add = mockAdd;
    close = mockClose;
    on = vi.fn().mockReturnThis();
  }

  class MockWorker {
    close = mockClose;
    on = vi.fn().mockReturnThis();
  }

  return {
    Queue: vi.fn().mockImplementation(() => new MockQueue()),
    Worker: vi.fn().mockImplementation(() => new MockWorker()),
    QueueEvents: vi.fn().mockImplementation(() => ({
      close: mockClose,
      on: vi.fn().mockReturnThis(),
    })),
  };
});

// ── MOCK: nodemailer ────────────────────────────────────────────────────────────
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
    }),
  },
}));

// ── Table cleanup ─────────────────────────────────────────────────────────────
// All tables that need to be cleaned between tests.
// Order matters: child tables BEFORE parent tables (for FK compliance with DELETE).
// Tables with onDelete: Cascade handle their own children automatically.
// Tables with onDelete: Restrict (the Prisma default) MUST be deleted before their parent.
// IMPORTANT: popular_resources and product_updates have RESTRICT FKs to User,
// so they must appear BEFORE User in this list.
const ALL_TABLES = [
  'CommentMention', 'Comment', 'TaskLabel', 'TaskAssignee', 'TaskDependency',
  'TaskRecurrence', 'DailyTask', 'TimeEntry', 'FocusSession', 'AnnouncementTarget',
  'MeetingAttendee', 'FeatureVote', 'ProjectFavorite', 'ProjectMember',
  'ProjectMilestone', 'ProjectSection', 'ProjectView', 'Sprint', 'BurnoutSignal',
  'CalendarDayAggregate', 'GoalCheckpoint', 'SystemCalendarEvent', 'UserCapacity',
  'UserWorkSchedule', 'UploadRateLimit',
  'EnergyLevel', 'WellnessRecommendation',
  'File', 'Activity', 'Notification',
  'Task', 'Label', 'FeatureRequest', 'Announcement', 'Meeting', 'Project',
  'JobPosting', 'Invoice', 'Subscription', 'Payment', 'UsageRecord', 'BillingEvent',
  'WorkspaceInvitation', 'WorkspaceMember', 'Workspace',
  'Account', 'VerificationToken', 'PasswordResetToken',
  // popular_resources and product_updates have RESTRICT FKs to User — must come before User
  'ContactMessage', 'TemplateList', 'SubscribeList', 'Integration',
  'popular_resources', 'product_updates',
  'User',
] as const;

// Build the list of tables that actually exist in the DB.
let _cachedDeleteTables: string[] | null = null;

async function getDeleteTables(): Promise<string[]> {
  if (_cachedDeleteTables !== null) return _cachedDeleteTables;

  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const existing = new Set(rows.map((r) => r.tablename));
    _cachedDeleteTables = ALL_TABLES.filter((t) => existing.has(t));
    return _cachedDeleteTables;
  } catch {
    return [];
  }
}

// Per-file DB-availability probe.
// IMPORTANT: We reset this to `null` in afterAll so that the NEXT test file
// (which shares this process if singleFork is true) will re-probe.
let dbAvailable: boolean | null = null;

async function checkDbAvailable(): Promise<boolean> {
  if (dbAvailable !== null) return dbAvailable;
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'User'
      ) AS "exists"`;
    dbAvailable = result[0]?.exists === true;
  } catch (error) {
    console.warn('[setup] Database check failed:', error);
    dbAvailable = false;
  }
  return dbAvailable;
}

// DELETE all test data between tests.
// Each DELETE is an individual statement. If one deadlocks (40P01), it is
// retried once — deadlocks are transient and a retry almost always succeeds.
async function deleteAllTables(): Promise<void> {
  const tables = await getDeleteTables();
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    } catch (err: any) {
      // Retry once on deadlock (PostgreSQL error code 40P01)
      if (err?.code === '40P01') {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
      }
      // FK violations during partial cleanup are non-fatal — skip silently
    }
  }
}

beforeAll(async () => {
  redisStore.clear();
  clearFactoryCaches();
  try {
    await prisma.$connect();
  } catch (error) {
    console.warn('[setup] Failed to connect to database:', error);
  }
  if (!(await checkDbAvailable())) return;
  try {
    await deleteAllTables();
  } catch (err: any) {
    console.warn('[setup] beforeAll DELETE failed:', err?.message ?? err);
    dbAvailable = null;
  }
});

afterEach(async () => {
  redisStore.clear();
  if (!(await checkDbAvailable())) return;
  try {
    await deleteAllTables();
  } catch (err: any) {
    console.warn('[setup] afterEach DELETE failed (DB may have reset):', err?.message ?? err);
    dbAvailable = null;
  }
});

afterEach(() => {
  process.env.FOCURA_ADMIN_IDS = '';
});

afterAll(async () => {
  dbAvailable = null;
  _cachedDeleteTables = null;
  await prisma.$disconnect();
});
