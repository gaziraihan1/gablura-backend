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

const createInMemoryRedisMock = () => ({
  get:    vi.fn(async (key: string) => redisStore.get(key) ?? null),
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
  quit:   vi.fn().mockResolvedValue('OK'),
  status: 'ready',
});

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
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockResolvedValue({
      success: true,
      remaining: 99,
      reset: Date.now() + 60_000,
    }),
  })),
}));

// ── MOCK: lib/redis/redis.client.ts ───────────────────────────────────────────
const noopRedisClient = createInMemoryRedisMock();

vi.mock('../lib/redis/redis.client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(noopRedisClient),
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

// ── Table truncation ──────────────────────────────────────────────────────────
const TRUNCATE_ORDER = [
  'CommentMention', 'Comment', 'TaskLabel', 'TaskAssignee', 'TaskDependency',
  'TaskRecurrence', 'DailyTask', 'TimeEntry', 'FocusSession', 'AnnouncementTarget',
  'MeetingAttendee', 'FeatureVote', 'ProjectFavorite', 'ProjectMember',
  'ProjectMilestone', 'ProjectSection', 'ProjectView', 'Sprint', 'BurnoutSignal',
  'CalendarDayAggregate', 'GoalCheckpoint', 'SystemCalendarEvent', 'UserCapacity',
  'UserWorkSchedule', 'UploadRateLimit', 'File', 'Activity', 'Notification',
  'Task', 'Label', 'FeatureRequest', 'Announcement', 'Meeting', 'Project',
  'Invoice', 'Subscription', 'Payment', 'UsageRecord', 'BillingEvent',
  'WorkspaceInvitation', 'WorkspaceMember', 'Workspace', 'RefreshToken',
  'Session', 'Account', 'VerificationToken', 'PasswordResetToken', 'User', 'Plan',
] as const;

afterEach(async () => {
  redisStore.clear();
  for (const table of TRUNCATE_ORDER) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    } catch {
      // Table doesn't exist in this schema version — skip
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});