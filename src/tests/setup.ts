import { afterAll, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL   = process.env.TEST_DATABASE_URL;
}

// CRITICAL: Remove Upstash vars so authenticate() skips revocation check
// and auth routes skip Redis calls — the mock handles everything else
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// ── MOCK: node-cron ───────────────────────────────────────────────────────────
vi.mock('node-cron', () => ({
  default:  { schedule: vi.fn() },
  schedule: vi.fn(),
}));

const redisMockInstance = {
  get:    vi.fn().mockResolvedValue(null),
  set:    vi.fn().mockResolvedValue('OK'),
  setex:  vi.fn().mockResolvedValue('OK'),
  del:    vi.fn().mockResolvedValue(1),
  ping:   vi.fn().mockResolvedValue('PONG'),
  quit:   vi.fn().mockResolvedValue('OK'),
  on:     vi.fn().mockReturnThis(),
  status: 'ready',
};
const RedisMock = vi.fn().mockImplementation(() => redisMockInstance);

vi.mock('ioredis', () => ({
  default: RedisMock,   // import Redis from 'ioredis'
  Redis:   RedisMock,   // import { Redis } from 'ioredis'
}));

const redisStore = new Map<string, string>();

const createInMemoryRedisMock = () => ({
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      if (redisStore.delete(key)) deleted += 1;
    }
    return deleted;
  }),
  keys: vi.fn(async (pattern: string) => {
    if (!pattern.includes('*')) return redisStore.has(pattern) ? [pattern] : [];
    const regex = new RegExp(`^${pattern.replaceAll('*', '.*')}$`);
    return [...redisStore.keys()].filter((key) => regex.test(key));
  }),
});

// ── MOCK: @upstash/redis ──────────────────────────────────────────────────────
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => createInMemoryRedisMock()),
}));

const noopRedisClient = createInMemoryRedisMock();

vi.mock('../redis/redis.client.js', () => ({
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
  getRedisClient: vi.fn().mockReturnValue(noopRedisClient),
  redis:          null,
}));

const mockRedisForLib = {
  ...createInMemoryRedisMock(),
  decr:   vi.fn().mockResolvedValue(0),
  incr:   vi.fn().mockResolvedValue(1),
  zrem:   vi.fn().mockResolvedValue(1),
  zcard:  vi.fn().mockResolvedValue(0),
  zadd:   vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zremarangebyscore: vi.fn().mockResolvedValue(0),
  eval:   vi.fn().mockResolvedValue(1),
  pipeline: vi.fn().mockReturnValue({
    get:    vi.fn().mockReturnThis(),
    set:    vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard:  vi.fn().mockReturnThis(),
    zadd:   vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec:   vi.fn().mockResolvedValue([null, 0, 1, 1], ),
  }),
}

// ── MOCK: src/lib/redis.ts ────────────────────────────────────────────────────
// auth.routes.ts imports: import { redis } from '../lib/redis.js'
// When redis is null, auth routes skip all Redis operations (by design).
vi.mock('../lib/redis.js', () => ({
  redis: mockRedisForLib,
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

// ── MOCK: Cloudinary ─────────────────────────────────────────────────────────
vi.mock('cloudinary', () => ({
  v2: {
    config:   vi.fn(),
    uploader: {
      upload:  vi.fn().mockResolvedValue({ secure_url: 'https://cdn.test/img.png', public_id: 'test_id' }),
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

// ── Table truncation — exact model names from your Prisma schema ──────────────
// ORDER MATTERS: children before parents (FK dependency order).
// NO "SubTask" — it does not exist. Task uses parentId self-relation.
// TRUNCATE with CASCADE handles the self-reference safely.
const TRUNCATE_ORDER = [
  'CommentMention',
  'Comment',
  'TaskLabel',
  'TaskAssignee',
  'TaskDependency',
  'TaskRecurrence',
  'DailyTask',
  'TimeEntry',
  'FocusSession',
  'AnnouncementTarget',
  'MeetingAttendee',
  'FeatureVote',
  'ProjectFavorite',
  'ProjectMember',
  'ProjectMilestone',
  'ProjectSection',
  'ProjectView',
  'Sprint',
  'BurnoutSignal',
  'CalendarDayAggregate',
  'GoalCheckpoint',
  'SystemCalendarEvent',
  'UserCapacity',
  'UserWorkSchedule',
  'UploadRateLimit',
  'File',
  'Activity',
  'Notification',
  'Task',           // self-referencing via parentId — CASCADE cleans children
  'Label',
  'FeatureRequest',
  'Announcement',
  'Meeting',
  'Project',
  'Invoice',
  'Subscription',
  'Payment',
  'UsageRecord',
  'BillingEvent',
  'WorkspaceInvitation',
  'WorkspaceMember',
  'Workspace',
  'RefreshToken',
  'Session',
  'Account',
  'VerificationToken',
  'PasswordResetToken',
  'User',
  'Plan',
] as const;

afterEach(async () => {
  redisStore.clear();
  for (const table of TRUNCATE_ORDER) {
    try {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`
      );
    } catch {
      // Table doesn't exist in this schema version — skip silently
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});