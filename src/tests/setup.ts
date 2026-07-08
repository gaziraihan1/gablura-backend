import { afterAll, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';

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

const createInMemoryRedisMock = () => {
  const mock = {
    get:    vi.fn(async (key: string) => redisStore.get(key) ?? null),
    exists:   vi.fn(async (key: string) => redisStore.has(key) ? 1 : 0),
    set:    vi.fn(async (key: string, value: string) => { redisStore.set(key, value); return 'OK'; }),
    setex:  vi.fn(async (key: string, _ttl: number, value: string) => { redisStore.set(key, value); return 'OK'; }),
    del:    vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) if (redisStore.delete(key)) deleted++;
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
      const next = Math.max(0, cur - n);
      redisStore.set(key, String(next));
      return next;
    }),
    zrem:   vi.fn().mockResolvedValue(1),
    zcard:  vi.fn().mockResolvedValue(0),
    zadd:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    sadd:   vi.fn().mockResolvedValue(1),
    srem:   vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
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

// ── MOCK: nodemailer ────────────────────────────────────────────────────────────
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
    }),
  },
}));

// ── Table truncation ──────────────────────────────────────────────────────────
// All tables that need to be cleaned between tests.
// Order doesn't matter — PostgreSQL handles FK dependencies via CASCADE.
const ALL_TABLES = [
  'CommentMention', 'Comment', 'TaskLabel', 'TaskAssignee', 'TaskDependency',
  'TaskRecurrence', 'DailyTask', 'TimeEntry', 'FocusSession', 'AnnouncementTarget',
  'MeetingAttendee', 'FeatureVote', 'ProjectFavorite', 'ProjectMember',
  'ProjectMilestone', 'ProjectSection', 'ProjectView', 'Sprint', 'BurnoutSignal',
  'CalendarDayAggregate', 'GoalCheckpoint', 'SystemCalendarEvent', 'UserCapacity',
  'UserWorkSchedule', 'UploadRateLimit', 'File', 'Activity', 'Notification',
  'Task', 'Label', 'FeatureRequest', 'Announcement', 'Meeting', 'Project',
  'JobPosting', 'Invoice', 'Subscription', 'Payment', 'UsageRecord', 'BillingEvent',
  'WorkspaceInvitation', 'WorkspaceMember', 'Workspace', 'RefreshToken',
  'Session', 'Account', 'VerificationToken', 'PasswordResetToken', 'User',
  'ContactMessage', 'TemplateList', 'SubscribeList', 'Integration', 'popular_resources', 'product_updates',
] as const;

// Build a single atomic TRUNCATE statement for all tables.
// A single TRUNCATE of multiple tables in one statement is fully atomic
// in PostgreSQL and handles all FK cycles via CASCADE — no ordering needed.
const TRUNCATE_ALL_SQL = `TRUNCATE TABLE ${
  ALL_TABLES.map((t) => `"${t}"`).join(', ')
} RESTART IDENTITY CASCADE`;

// Per-file DB-availability probe.
// IMPORTANT: We reset this to `null` in afterAll so that the NEXT test file
// (which shares the same prog
// If we kept it permanently set to `true` and the connection drops or tables
// disappear, subsequent files would run a broken truncation silently.
let dbAvailable: boolean | null = null;

async function checkDbAvailable(): Promise<boolean> {
  if (dbAvailable !== null) return dbAvailable;
  try {
    // Quick ping to confirm the connection is alive
    await prisma.$queryRaw`SELECT 1`;
    // Check that the core schema has actually been applied
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'User'
      ) AS "exists"`;
    dbAvailable = result[0]?.exists === true;
  } catch {
    dbAvailable = false;
  }
  return dbAvailable;
}

afterEach(async () => {
  // Always clear the in-memory Redis mock, even when the DB is unavailable.
  redisStore.clear();

  if (!(await checkDbAvailable())) return;

  // Single atomic TRUNCATE: faster than 47 sequential calls, and fully
  // consistent — PostgreSQL either cleans everything or nothing.
  try {
    await prisma.$executeRawUnsafe(TRUNCATE_ALL_SQL);
  } catch (err: any) {
    // If the truncation fails, the next test's beforeEach will also fail.
    // Log clearly so the failure is visible rather than silently swallowed.
    // Then reset the probe so we re-check on the next afterEach.
    console.warn('[setup] afterEach TRUNCATE failed (DB may have reset):', err?.message ?? err);
    dbAvailable = null;
  }
});

afterEach(() => {
  // Clear admin IDs registered during this test.
  process.env.FOCURA_ADMIN_IDS = '';
});

afterAll(async () => {
  // Reset the probe so the next test FILE (which shares this process in
  // singleFork mode) will re-probe DB availability from scratch.
  dbAvailable = null;
  await prisma.$disconnect();
});