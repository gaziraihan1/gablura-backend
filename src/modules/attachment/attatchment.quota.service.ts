import { getRedisClient } from "../../redis/redis.client.js";
import {
  WorkspacePlan,
  StorageLimits,
  SlidingWindowResult,
  UploadCheckResult,
  StorageInfo,
} from "./attachment.quota.types.js";

// ─── Storage Limits per Plan ──────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;
const TB = 1024 * GB;

export function getStorageLimits(plan: WorkspacePlan): StorageLimits {
  switch (plan) {
    case "ENTERPRISE":
      return {
        maxStorageBytes:        TB,
        maxFileSizeBytes:       500 * 1024 * 1024, // 500 MB per file
        maxDailyUploadsPerUser: null,
        uploadsPerMinute:       null,
        uploadsPerHour:         null,
      };

    case "BUSINESS":
      return {
        maxStorageBytes:        100 * GB,
        maxFileSizeBytes:       100 * 1024 * 1024, // 100 MB per file
        maxDailyUploadsPerUser: null,
        uploadsPerMinute:       30,
        uploadsPerHour:         null,
      };

    case "PRO":
      return {
        maxStorageBytes:        10 * GB,
        maxFileSizeBytes:       25 * 1024 * 1024, // 25 MB per file
        maxDailyUploadsPerUser: 100,
        uploadsPerMinute:       10,
        uploadsPerHour:         60,
      };

    case "FREE":
    default:
      return {
        maxStorageBytes:        1 * GB,
        maxFileSizeBytes:       5 * 1024 * 1024, // 5 MB per file
        maxDailyUploadsPerUser: 10,
        uploadsPerMinute:       2,
        uploadsPerHour:         10,
      };
  }
}

// ─── Redis Key Builders ───────────────────────────────────────────────────────

function todaySegment(): string {
  return new Date().toISOString().slice(0, 10);
}

function midnightUnix(): number {
  const midnight = new Date();
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

const KEYS = {
  workspaceStorageBytes: (workspaceId: string) =>
    `storage:workspace:${workspaceId}:bytes`,

  userDailyUploads: (workspaceId: string, userId: string) =>
    `storage:daily:${workspaceId}:${userId}:${todaySegment()}`,

  userMinuteWindow: (workspaceId: string, userId: string) =>
    `storage:rl:minute:${workspaceId}:${userId}`,

  userHourWindow: (workspaceId: string, userId: string) =>
    `storage:rl:hour:${workspaceId}:${userId}`,
};

// ─── Atomic increment with expiry (Lua) ──────────────────────────────────────

const INCR_WITH_EXPIRY_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIREAT', KEYS[1], ARGV[1])
end
return current
`;

async function atomicIncr(key: string, expireAtUnix: number): Promise<number> {
  const redis = getRedisClient();
  // ioredis: eval(script, numkeys, ...keys, ...args)
  return (await redis.eval(
    INCR_WITH_EXPIRY_SCRIPT,
    1,
    key,
    String(expireAtUnix),
  )) as number;
}

// ─── Sliding Window Check ─────────────────────────────────────────────────────

async function slidingWindowCheck(
  key:        string,
  limit:      number,
  windowMs:   number,
  ttlSeconds: number,
): Promise<SlidingWindowResult> {
  const redis       = getRedisClient();
  const now         = Date.now();
  const windowStart = now - windowMs;
  const member      = `${now}:${Math.random()}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  pipeline.zadd(key, now, member);          // ioredis: zadd(key, score, member)
  pipeline.expire(key, ttlSeconds);

  const results = await pipeline.exec();
  // results: [[err, reply], [err, reply], ...]
  const countBefore = (results?.[1]?.[1] ?? 0) as number;

  if (countBefore >= limit) {
    // Rollback the zadd we optimistically wrote
    await redis.zrem(key, member);
    return { allowed: false, count: countBefore, retryAfterMs: windowMs };
  }

  return { allowed: true, count: countBefore + 1, retryAfterMs: 0 };
}

// ─── Storage Usage ────────────────────────────────────────────────────────────

/**
 * Get current workspace storage usage in bytes from Redis.
 * Returns 0 if the key doesn't exist yet (first upload).
 */
export async function getWorkspaceStorageBytes(workspaceId: string): Promise<number> {
  const redis = getRedisClient();
  const raw   = await redis.get(KEYS.workspaceStorageBytes(workspaceId));
  return raw ? parseInt(raw, 10) : 0;
}

/**
 * Atomically add bytes to the workspace storage counter.
 * Call AFTER a successful Cloudinary + DB write.
 */
export async function incrementWorkspaceStorage(
  workspaceId: string,
  bytes:        number,
): Promise<number> {
  const redis = getRedisClient();
  return (await redis.incrby(KEYS.workspaceStorageBytes(workspaceId), bytes)) as number;
}

/**
 * Atomically subtract bytes from the workspace storage counter.
 * Call AFTER a successful file deletion.
 */
export async function decrementWorkspaceStorage(
  workspaceId: string,
  bytes:        number,
): Promise<void> {
  const redis   = getRedisClient();
  const current = await getWorkspaceStorageBytes(workspaceId);
  const next    = Math.max(0, current - bytes);
  await redis.set(KEYS.workspaceStorageBytes(workspaceId), String(next));
}

/**
 * Seed the storage counter from the DB on first use (NX — no-op if already set).
 * Call once during workspace initialisation or on a cache miss.
 */
export async function seedWorkspaceStorageFromDb(
  workspaceId: string,
  totalBytes:  number,
): Promise<void> {
  const redis = getRedisClient();
  // ioredis SET … NX: only set if key doesn't exist
  await redis.set(
    KEYS.workspaceStorageBytes(workspaceId),
    String(totalBytes),
    "NX",
  );
}

// ─── Main Check + Consume ─────────────────────────────────────────────────────

/**
 * Runs all upload checks in order and — if allowed — atomically consumes quota.
 * Order: file size → workspace storage → per-minute rate → per-hour rate → daily count.
 *
 * Call BEFORE uploading to Cloudinary.
 */
export async function checkAndConsumeUploadQuota(
  userId:        string,
  workspaceId:   string,
  plan:          WorkspacePlan,
  fileSizeBytes: number,
): Promise<UploadCheckResult> {
  const limits       = getStorageLimits(plan);
  const expireAtUnix = midnightUnix();

  // 1. File size check (pure arithmetic — no Redis)
  if (fileSizeBytes > limits.maxFileSizeBytes) {
    const usedBytes = await getWorkspaceStorageBytes(workspaceId);
    return {
      allowed:          false,
      reason:           `File size ${formatBytes(fileSizeBytes)} exceeds the ${formatBytes(limits.maxFileSizeBytes)} per-file limit on the ${plan} plan.`,
      code:             "FILE_TOO_LARGE",
      storageUsedBytes: usedBytes,
      storageMaxBytes:  limits.maxStorageBytes,
      storageUsedPct:   limits.maxStorageBytes ? (usedBytes / limits.maxStorageBytes) * 100 : null,
      remainingBytes:   limits.maxStorageBytes ? Math.max(0, limits.maxStorageBytes - usedBytes) : null,
    };
  }

  // 2. Workspace storage cap
  const usedBytes = await getWorkspaceStorageBytes(workspaceId);

  if (limits.maxStorageBytes !== null) {
    const afterUpload = usedBytes + fileSizeBytes;
    if (afterUpload > limits.maxStorageBytes) {
      return {
        allowed:          false,
        reason:           `Workspace storage full. Used ${formatBytes(usedBytes)} of ${formatBytes(limits.maxStorageBytes)}. Free up space or upgrade your plan.`,
        code:             "STORAGE_FULL",
        storageUsedBytes: usedBytes,
        storageMaxBytes:  limits.maxStorageBytes,
        storageUsedPct:   (usedBytes / limits.maxStorageBytes) * 100,
        remainingBytes:   Math.max(0, limits.maxStorageBytes - usedBytes),
      };
    }
  }

  const storageUsedPct = limits.maxStorageBytes
    ? ((usedBytes + fileSizeBytes) / limits.maxStorageBytes) * 100
    : null;

  const remainingBytes = limits.maxStorageBytes
    ? Math.max(0, limits.maxStorageBytes - usedBytes - fileSizeBytes)
    : null;

  // 3. Per-minute sliding window
  if (limits.uploadsPerMinute !== null) {
    const minuteCheck = await slidingWindowCheck(
      KEYS.userMinuteWindow(workspaceId, userId),
      limits.uploadsPerMinute,
      60_000,
      65,
    );
    if (!minuteCheck.allowed) {
      return {
        allowed:          false,
        reason:           `Upload rate limit: max ${limits.uploadsPerMinute} files/minute on the ${plan} plan. Please wait a moment.`,
        code:             "RATE_LIMIT_MINUTE",
        retryAfterMs:     minuteCheck.retryAfterMs,
        storageUsedBytes: usedBytes,
        storageMaxBytes:  limits.maxStorageBytes,
        storageUsedPct,
        remainingBytes,
      };
    }
  }

  // 4. Per-hour sliding window
  if (limits.uploadsPerHour !== null) {
    const hourCheck = await slidingWindowCheck(
      KEYS.userHourWindow(workspaceId, userId),
      limits.uploadsPerHour,
      3_600_000,
      3_660,
    );
    if (!hourCheck.allowed) {
      return {
        allowed:          false,
        reason:           `Upload rate limit: max ${limits.uploadsPerHour} files/hour on the ${plan} plan.`,
        code:             "RATE_LIMIT_HOUR",
        retryAfterMs:     hourCheck.retryAfterMs,
        storageUsedBytes: usedBytes,
        storageMaxBytes:  limits.maxStorageBytes,
        storageUsedPct,
        remainingBytes,
      };
    }
  }

  // 5. Daily upload count (atomic INCR via Lua)
  if (limits.maxDailyUploadsPerUser !== null) {
    const dailyKey = KEYS.userDailyUploads(workspaceId, userId);
    const newCount = await atomicIncr(dailyKey, expireAtUnix);

    if (newCount > limits.maxDailyUploadsPerUser) {
      const redis = getRedisClient();
      await redis.decr(dailyKey); // rollback
      return {
        allowed:          false,
        reason:           `Daily upload limit reached (${limits.maxDailyUploadsPerUser} uploads/day on the ${plan} plan). Resets at midnight.`,
        code:             "DAILY_LIMIT",
        storageUsedBytes: usedBytes,
        storageMaxBytes:  limits.maxStorageBytes,
        storageUsedPct,
        remainingBytes,
      };
    }
  }

  return {
    allowed:          true,
    storageUsedBytes: usedBytes,
    storageMaxBytes:  limits.maxStorageBytes,
    storageUsedPct,
    remainingBytes,
  };
}

/**
 * Roll back the daily counter if Cloudinary or DB write fails after quota was consumed.
 */
export async function rollbackUploadQuota(
  userId:      string,
  workspaceId: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.decr(KEYS.userDailyUploads(workspaceId, userId));
  } catch {
    // best-effort
  }
}

// ─── Storage Info (for frontend display) ─────────────────────────────────────

export async function getStorageInfo(
  workspaceId: string,
  plan:        WorkspacePlan,
): Promise<StorageInfo> {
  const limits    = getStorageLimits(plan);
  const usedBytes = await getWorkspaceStorageBytes(workspaceId);

  const maxBytes       = limits.maxStorageBytes;
  const remainingBytes = maxBytes !== null ? Math.max(0, maxBytes - usedBytes) : null;
  const usedPct        = maxBytes !== null ? Math.min(100, (usedBytes / maxBytes) * 100) : null;

  return {
    plan,
    usedBytes,
    maxBytes,
    remainingBytes,
    usedPct,
    usedFormatted:  formatBytes(usedBytes),
    maxFormatted:   maxBytes !== null ? formatBytes(maxBytes) : null,
    isNearLimit:    usedPct !== null && usedPct >= 80,
    isFull:         usedPct !== null && usedPct >= 100,
    limits,
  };
}

// ─── Formatting Helper ────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i     = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}