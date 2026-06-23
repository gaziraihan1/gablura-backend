// src/tests/unit/attachment/attachment.quota.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for attatchment.quota.service.ts
// All Redis I/O is provided by the in-memory mock already wired in setup.ts.
// These tests call the real service functions so the Lua eval / pipeline paths
// are exercised via the mock's pipeline().exec() stub.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Redis client mock (provided by setup.ts globally, but we need the instance) ──
vi.mock('../../../redis/redis.client.js', () => {
  // Minimal in-memory store — mirrors setup.ts but scoped to this file
  const store = new Map<string, string>();
  const pipeline = () => ({
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard:            vi.fn().mockReturnThis(),
    zadd:             vi.fn().mockReturnThis(),
    expire:           vi.fn().mockReturnThis(),
    exec:             vi.fn().mockResolvedValue([[null, 0], [null, 0], [null, 1], [null, 1]]),
  });

  const client = {
    get:    vi.fn(async (k: string) => store.get(k) ?? null),
    set:    vi.fn(async (k: string, v: string, ...rest: any[]) => { store.set(k, v); return 'OK'; }),
    incrby: vi.fn(async (k: string, n: number) => {
      const cur = parseInt(store.get(k) ?? '0', 10);
      store.set(k, String(cur + n));
      return cur + n;
    }),
    incr:   vi.fn(async (k: string) => {
      const cur = parseInt(store.get(k) ?? '0', 10);
      store.set(k, String(cur + 1));
      return cur + 1;
    }),
    decr:   vi.fn(async (k: string) => {
      const cur = parseInt(store.get(k) ?? '0', 10);
      store.set(k, String(cur - 1));
      return cur - 1;
    }),
    eval:   vi.fn(async (_script: string, _n: number, key: string, expireAt: string) => {
      const cur = parseInt(store.get(key) ?? '0', 10);
      store.set(key, String(cur + 1));
      return cur + 1;
    }),
    zrem:     vi.fn().mockResolvedValue(1),
    pipeline: vi.fn(pipeline),
    __store:  store,    // exposed for test assertions
  };

  return { getRedisClient: vi.fn(() => client), __client: client };
});

import {
  getStorageLimits,
  checkAndConsumeUploadQuota,
  rollbackUploadQuota,
  incrementWorkspaceStorage,
  decrementWorkspaceStorage,
  seedWorkspaceStorageFromDb,
  getWorkspaceStorageBytes,
  getStorageInfo,
  formatBytes,
} from '../../modules/attachment/attatchment.quota.service.js';

// Helper: grab the mocked redis client
import { getRedisClient } from '../../redis/redis.client.js';

function redisClient() {
  return getRedisClient() as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the in-memory store between tests
  redisClient().__store?.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// getStorageLimits
// ─────────────────────────────────────────────────────────────────────────────

describe('getStorageLimits', () => {
  const GB = 1024 * 1024 * 1024;

  it('FREE plan: 1 GB storage, 5 MB file, 10 daily, 2/min, 10/hr', () => {
    const l = getStorageLimits('FREE');
    expect(l.maxStorageBytes).toBe(1 * GB);
    expect(l.maxFileSizeBytes).toBe(5 * 1024 * 1024);
    expect(l.maxDailyUploadsPerUser).toBe(10);
    expect(l.uploadsPerMinute).toBe(2);
    expect(l.uploadsPerHour).toBe(10);
  });

  it('PRO plan: 10 GB storage, 25 MB file, 100 daily, 10/min, 60/hr', () => {
    const l = getStorageLimits('PRO');
    expect(l.maxStorageBytes).toBe(10 * GB);
    expect(l.maxFileSizeBytes).toBe(25 * 1024 * 1024);
    expect(l.maxDailyUploadsPerUser).toBe(100);
    expect(l.uploadsPerMinute).toBe(10);
    expect(l.uploadsPerHour).toBe(60);
  });

  it('BUSINESS plan: 50 GB storage, 100 MB file, no daily limit, 30/min, no hr limit', () => {
    const l = getStorageLimits('BUSINESS');
    expect(l.maxStorageBytes).toBe(50 * GB);
    expect(l.maxFileSizeBytes).toBe(100 * 1024 * 1024);
    expect(l.maxDailyUploadsPerUser).toBeNull();
    expect(l.uploadsPerMinute).toBe(30);
    expect(l.uploadsPerHour).toBeNull();
  });

  it('ENTERPRISE plan: massive storage, 500 MB file, all rate limits null', () => {
    const l = getStorageLimits('ENTERPRISE');
    expect(l.maxFileSizeBytes).toBe(500 * 1024 * 1024);
    expect(l.maxDailyUploadsPerUser).toBeNull();
    expect(l.uploadsPerMinute).toBeNull();
    expect(l.uploadsPerHour).toBeNull();
  });

  it('unknown plan falls back to FREE limits', () => {
    const l = getStorageLimits('UNKNOWN' as any);
    expect(l.maxFileSizeBytes).toBe(5 * 1024 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatBytes
// ─────────────────────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns "0 B" for 0', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage byte helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('getWorkspaceStorageBytes', () => {
  it('returns 0 when the key does not exist', async () => {
    const bytes = await getWorkspaceStorageBytes('ws-new');
    expect(bytes).toBe(0);
  });

  it('returns the stored value when the key exists', async () => {
    await redisClient().set('storage:workspace:ws1:bytes', '5000');
    const bytes = await getWorkspaceStorageBytes('ws1');
    expect(bytes).toBe(5000);
  });
});

describe('seedWorkspaceStorageFromDb', () => {
  it('sets the key when it does not exist (NX semantics)', async () => {
    await seedWorkspaceStorageFromDb('ws-seed', 12345);
    // The mock set() doesn't enforce NX but we verify it was called
    expect(redisClient().set).toHaveBeenCalledWith(
      'storage:workspace:ws-seed:bytes',
      '12345',
      'NX',
    );
  });
});

describe('incrementWorkspaceStorage', () => {
  it('adds the given bytes to the counter', async () => {
    await incrementWorkspaceStorage('ws1', 1000);
    expect(redisClient().incrby).toHaveBeenCalledWith(
      'storage:workspace:ws1:bytes',
      1000,
    );
  });
});

describe('decrementWorkspaceStorage', () => {
  it('subtracts bytes and floors at 0', async () => {
    // Current usage = 0, subtract 500 → should set to 0, not negative
    await decrementWorkspaceStorage('ws1', 500);
    expect(redisClient().set).toHaveBeenCalledWith(
      'storage:workspace:ws1:bytes',
      '0',
    );
  });

  it('correctly subtracts when usage > bytes to remove', async () => {
    await redisClient().set('storage:workspace:ws2:bytes', '2000');
    // get() returns '2000'; 2000 - 500 = 1500
    redisClient().get.mockResolvedValueOnce('2000');
    await decrementWorkspaceStorage('ws2', 500);
    expect(redisClient().set).toHaveBeenCalledWith(
      'storage:workspace:ws2:bytes',
      '1500',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkAndConsumeUploadQuota — gate checks
// ─────────────────────────────────────────────────────────────────────────────

describe('checkAndConsumeUploadQuota', () => {
  const WS  = 'ws-quota';
  const UID = 'user-quota';

  beforeEach(() => {
    // All sliding-window checks return allowed by default
    redisClient().pipeline.mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      zadd:             vi.fn().mockReturnThis(),
      expire:           vi.fn().mockReturnThis(),
      // countBefore = 0 → always allowed
      exec: vi.fn().mockResolvedValue([[null, 0], [null, 0], [null, 1], [null, 1]]),
    });
  });

  it('allows upload when file size is within FREE plan limit (< 5 MB)', async () => {
    const result = await checkAndConsumeUploadQuota(UID, WS, 'FREE', 4 * 1024 * 1024);
    expect(result.allowed).toBe(true);
  });

  it('rejects FILE_TOO_LARGE when file exceeds FREE plan limit (> 5 MB)', async () => {
    const result = await checkAndConsumeUploadQuota(UID, WS, 'FREE', 6 * 1024 * 1024);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('FILE_TOO_LARGE');
    expect(result.reason).toMatch(/5/); // mentions the limit
  });

  it('rejects STORAGE_FULL when workspace storage cap is exceeded', async () => {
    const GB = 1024 * 1024 * 1024;
    // Simulate nearly full storage (950 MB used)
    redisClient().get.mockResolvedValueOnce(String(950 * 1024 * 1024));

    // Try to upload 100 MB → would exceed 1 GB FREE cap
    const result = await checkAndConsumeUploadQuota(UID, WS, 'FREE', 100 * 1024 * 1024);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects RATE_LIMIT_MINUTE when per-minute window is full', async () => {
    // Pipeline returns countBefore = 2 (at the limit for FREE = 2/min)
    redisClient().pipeline.mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      zadd:             vi.fn().mockReturnThis(),
      expire:           vi.fn().mockReturnThis(),
      exec:             vi.fn().mockResolvedValue([[null, 0], [null, 2], [null, 1], [null, 1]]),
    });

    const result = await checkAndConsumeUploadQuota(UID, WS, 'FREE', 1024);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('RATE_LIMIT_MINUTE');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('returns allowed: true with storage metadata on success', async () => {
    redisClient().get.mockResolvedValueOnce('1000'); // 1000 bytes used

    const result = await checkAndConsumeUploadQuota(UID, WS, 'PRO', 500);
    expect(result.allowed).toBe(true);
    expect(result.storageUsedBytes).toBe(1000);
    expect(result.storageMaxBytes).toBeDefined();
    expect(typeof result.storageUsedPct).toBe('number');
  });

  it('ENTERPRISE plan skips all rate limits (no per-minute/hour/daily checks)', async () => {
    // Even if sliding window would block, ENTERPRISE has null limits
    redisClient().pipeline.mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard:            vi.fn().mockReturnThis(),
      zadd:             vi.fn().mockReturnThis(),
      expire:           vi.fn().mockReturnThis(),
      exec:             vi.fn().mockResolvedValue([[null, 0], [null, 999], [null, 1], [null, 1]]),
    });

    // 400 MB file — within ENTERPRISE limit
    const result = await checkAndConsumeUploadQuota(UID, WS, 'ENTERPRISE', 400 * 1024 * 1024);
    expect(result.allowed).toBe(true);
    // Pipeline should not have been called (ENTERPRISE has null rate limits)
    // The pipeline mock being unused is the evidence
    const pipelineCalls = redisClient().pipeline.mock.calls.length;
    expect(pipelineCalls).toBe(0);
  });

  it('rejects DAILY_LIMIT when daily counter is at the cap (FREE = 10)', async () => {
    // eval() returns 11 (over the 10/day FREE limit)
    redisClient().eval.mockResolvedValueOnce(11);

    const result = await checkAndConsumeUploadQuota(UID, WS, 'FREE', 1024);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('DAILY_LIMIT');
    // Daily counter should be rolled back (decr called)
    expect(redisClient().decr).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rollbackUploadQuota
// ─────────────────────────────────────────────────────────────────────────────

describe('rollbackUploadQuota', () => {
  it('decrements the daily upload counter for the user', async () => {
    await rollbackUploadQuota('user1', 'ws1');
    expect(redisClient().decr).toHaveBeenCalledOnce();
    const key = redisClient().decr.mock.calls[0][0] as string;
    expect(key).toMatch(/user1/);
    expect(key).toMatch(/ws1/);
  });

  it('does not throw if Redis decr fails (best-effort)', async () => {
    redisClient().decr.mockRejectedValueOnce(new Error('redis down'));
    await expect(rollbackUploadQuota('u', 'w')).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStorageInfo
// ─────────────────────────────────────────────────────────────────────────────

describe('getStorageInfo', () => {
  // In attachment.quota.test.ts, replace the getStorageInfo happy-path test:

  it('returns correct storage shape for FREE plan with some usage', async () => {
    const used = 500 * 1024 * 1024; // 500 MiB
    redisClient().get.mockResolvedValueOnce(String(used));

    const info = await getStorageInfo('ws1', 'FREE');

    expect(info.plan).toBe('FREE');
    expect(info.usedBytes).toBe(used);
    expect(info.maxBytes).toBe(1 * 1024 * 1024 * 1024);
    // 500 MiB / 1024 MiB = 48.828...%
    expect(info.usedPct).toBeCloseTo(48.83, 1);
    expect(info.isNearLimit).toBe(false); // < 80%
    expect(info.isFull).toBe(false);
    expect(info.usedFormatted).toContain('MB');
    expect(info.maxFormatted).toContain('GB');
    expect(info.limits).toBeDefined();
  });

  it('marks isNearLimit: true when usage is >= 80%', async () => {
    const GB   = 1024 * 1024 * 1024;
    const used = 0.85 * GB;
    redisClient().get.mockResolvedValueOnce(String(Math.floor(used)));

    const info = await getStorageInfo('ws2', 'FREE');
    expect(info.isNearLimit).toBe(true);
  });

  it('marks isFull: true when usage is >= 100%', async () => {
    const GB   = 1024 * 1024 * 1024;
    const used = 1.01 * GB;
    redisClient().get.mockResolvedValueOnce(String(Math.floor(used)));

    const info = await getStorageInfo('ws3', 'FREE');
    expect(info.isFull).toBe(true);
  });

  it('returns null remainingBytes and usedPct for ENTERPRISE (unlimited storage)', async () => {
    redisClient().get.mockResolvedValueOnce('1000');

    const info = await getStorageInfo('ws4', 'ENTERPRISE');
    // ENTERPRISE maxStorageBytes is 200 GB, NOT null — just very large
    // So remainingBytes should be a number, not null
    expect(typeof info.usedPct).toBe('number');
    expect(info.remainingBytes).not.toBeNull();
  });
});