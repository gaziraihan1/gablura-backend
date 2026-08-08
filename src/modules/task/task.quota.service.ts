import { prisma } from "../../lib/prisma.js";
import { getRedisClient } from "../../redis/redis.client.js";

function todaySegment(): string {
  return new Date().toISOString().slice(0, 10);
}

const KEYS = {
  personalDaily: (userId: string) =>
    `quota:personal:${userId}:${todaySegment()}`,
  workspaceDaily: (workspaceId: string) =>
    `quota:workspace:${workspaceId}:${todaySegment()}`,
  memberDaily: (workspaceId: string, userId: string) =>
    `quota:member:${workspaceId}:${userId}:${todaySegment()}`,
  workspaceMinuteWindow: (workspaceId: string) =>
    `rl:workspace:${workspaceId}:minute`,
  userPlan: (userId: string) => `plan:user:${userId}`,
  workspacePlan: (workspaceId: string) => `plan:workspace:${workspaceId}`,
};

export async function resolveUserPlan(userId: string): Promise<UserPlan> {
  const cacheKey = KEYS.userPlan(userId);
  const redis = getRedisClient();

  const cached = await redis.get(cacheKey);
  if (cached) return (cached === 'PRO' ? 'PRO' : 'FREE') as UserPlan;

  const bestSub = await prisma.subscription.findFirst({
    where: {
      workspace: { ownerId: userId },
      status: { in: ['ACTIVE', 'TRIALING'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { plan: { select: { name: true } } },
  });

  const planName = bestSub?.plan.name ?? 'FREE';
  await redis.setex(cacheKey, 600, planName);
  return (planName === 'PRO' ? 'PRO' : 'FREE') as UserPlan;
}

export async function resolveWorkspacePlan(
  workspaceId: string,
): Promise<WorkspacePlan> {
  const cacheKey = KEYS.workspacePlan(workspaceId);
  const redis = getRedisClient();

  const cached = await redis.get(cacheKey);
  if (cached) {
    if (cached === 'ENTERPRISE') return 'ENTERPRISE';
    if (cached === 'BUSINESS')   return 'BUSINESS';
    if (cached === 'PRO')        return 'PRO';
    return 'FREE';
  }

  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { plan: true },
  });

  const planName = (ws?.plan ?? 'FREE') as string;
  await redis.setex(cacheKey, 600, planName);

  if (planName === 'ENTERPRISE') return 'ENTERPRISE';
  if (planName === 'BUSINESS')   return 'BUSINESS';
  if (planName === 'PRO')        return 'PRO';
  return 'FREE';
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remaining: number | null;
  resetAt: Date;
  limit: number | null;
  usedToday: number;
  isUnlimited: boolean;
}

export type UserPlan = "FREE" | "PRO";
export type WorkspacePlan = "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE";

interface PersonalLimits {
  dailyLimit: number;
}

interface WorkspaceLimits {
  dailyWorkspaceTotal: number | null;
  dailyPerMember: number | null;
  perMinute: number | null;
  isUnlimited: boolean;
}

export function personalLimits(plan: UserPlan): PersonalLimits {
  return plan === "PRO" ? { dailyLimit: 500 } : { dailyLimit: 100 };
}

export function workspaceLimits(
  plan: WorkspacePlan,
  memberCount: number,
): WorkspaceLimits {
  const count = Math.max(1, memberCount);

  switch (plan) {
    case "ENTERPRISE":
    case "BUSINESS":
      return {
        dailyWorkspaceTotal: null,
        dailyPerMember: null,
        perMinute: null,
        isUnlimited: true,
      };

    case "PRO": {
      const total = 3000;
      const perMember = Math.max(500, Math.floor(total / count));
      return {
        dailyWorkspaceTotal: total,
        dailyPerMember: perMember,
        perMinute: 25,
        isUnlimited: false,
      };
    }

    default: {
      const total = 300;
      const perMember = Math.max(1, Math.floor(total / count));
      return {
        dailyWorkspaceTotal: total,
        dailyPerMember: perMember,
        perMinute: 5,
        isUnlimited: false,
      };
    }
  }
}

const incrWithExpiry = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIREAT', KEYS[1], ARGV[1])
end
return current
`;

async function atomicIncr(key: string, expireAtUnix: number): Promise<number> {
  const redis = getRedisClient();
  // ioredis eval: (script, numkeys, ...keys, ...args)
  const result = await redis.eval(incrWithExpiry, 1, key, String(expireAtUnix));
  return result as number;
}

async function checkAndRecordMinuteWindow(
  workspaceId: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const redis = getRedisClient();
  const key = KEYS.workspaceMinuteWindow(workspaceId);
  const now = Date.now();
  const windowStart = now - 60_000;
  const member = `${now}:${Math.random()}`;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zcard(key);
  pipe.zadd(key, now, member); // ioredis: zadd(key, score, member)
  pipe.expire(key, 65);
  const results = await pipe.exec();

  // results[i] is [error, value]
  const countBefore = (results?.[1]?.[1] as number) ?? 0;

  if (countBefore >= limit) {
    await redis.zrem(key, member);
    return { allowed: false, retryAfterMs: 60_000 };
  }

  return { allowed: true, retryAfterMs: 0 };
}

function midnightUnix(): number {
  const midnight = new Date();
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

export async function checkAndConsumePersonalQuota(
  userId: string,
  plan: UserPlan,
): Promise<QuotaCheckResult> {
  const redis = getRedisClient();
  const limits = personalLimits(plan);
  const key = KEYS.personalDaily(userId);
  const expireAt = midnightUnix();
  const resetAt = new Date(expireAt * 1000);

  const newCount = await atomicIncr(key, expireAt);

  if (newCount > limits.dailyLimit) {
    await redis.decr(key);
    return {
      allowed: false,
      reason: `Daily personal task limit reached (${limits.dailyLimit}/day on ${plan} plan). Resets at midnight.`,
      remaining: 0,
      resetAt,
      limit: limits.dailyLimit,
      usedToday: limits.dailyLimit,
      isUnlimited: false,
    };
  }

  return {
    allowed: true,
    remaining: limits.dailyLimit - newCount,
    resetAt,
    limit: limits.dailyLimit,
    usedToday: newCount,
    isUnlimited: false,
  };
}

export async function checkAndConsumeWorkspaceQuota(
  userId: string,
  workspaceId: string,
  plan: WorkspacePlan,
  memberCount: number,
  opts?: { skipMinuteRateLimit?: boolean },
): Promise<QuotaCheckResult> {
  const redis = getRedisClient();
  const limits = workspaceLimits(plan, memberCount);
  const expireAt = midnightUnix();
  const resetAt = new Date(expireAt * 1000);

  if (limits.isUnlimited) {
    return { allowed: true, remaining: null, resetAt, limit: null, usedToday: 0, isUnlimited: true };
  }

  if (limits.perMinute !== null && !opts?.skipMinuteRateLimit) {
    const rateCheck = await checkAndRecordMinuteWindow(workspaceId, limits.perMinute);
    if (!rateCheck.allowed) {
      return {
        allowed: false,
        reason: `Workspace rate limit reached (${limits.perMinute} tasks/min on ${plan} plan). Please wait a moment.`,
        remaining: 0,
        resetAt: new Date(Date.now() + rateCheck.retryAfterMs),
        limit: limits.perMinute,
        usedToday: 0,
        isUnlimited: false,
      };
    }
  }

  const wsKey = KEYS.workspaceDaily(workspaceId);
  const wsNewCount = await atomicIncr(wsKey, expireAt);

  if (limits.dailyWorkspaceTotal !== null && wsNewCount > limits.dailyWorkspaceTotal) {
    await redis.decr(wsKey);
    return {
      allowed: false,
      reason: `Workspace daily task limit reached (${limits.dailyWorkspaceTotal}/day on ${plan} plan). Resets at midnight.`,
      remaining: 0,
      resetAt,
      limit: limits.dailyWorkspaceTotal,
      usedToday: limits.dailyWorkspaceTotal,
      isUnlimited: false,
    };
  }

  const memberKey = KEYS.memberDaily(workspaceId, userId);
  const memberNewCount = await atomicIncr(memberKey, expireAt);

  if (limits.dailyPerMember !== null && memberNewCount > limits.dailyPerMember) {
    await Promise.all([redis.decr(wsKey), redis.decr(memberKey)]);
    return {
      allowed: false,
      reason: `Your daily task limit reached (${limits.dailyPerMember}/day per member on ${plan} plan). Resets at midnight.`,
      remaining: 0,
      resetAt,
      limit: limits.dailyPerMember,
      usedToday: memberNewCount - 1,
      isUnlimited: false,
    };
  }

  const wsRemaining =
    limits.dailyWorkspaceTotal !== null ? limits.dailyWorkspaceTotal - wsNewCount : null;
  const memberRemaining =
    limits.dailyPerMember !== null ? limits.dailyPerMember - memberNewCount : null;
  const remaining =
    wsRemaining !== null && memberRemaining !== null
      ? Math.min(wsRemaining, memberRemaining)
      : (wsRemaining ?? memberRemaining);

  return {
    allowed: true,
    remaining,
    resetAt,
    limit: limits.dailyPerMember ?? limits.dailyWorkspaceTotal,
    usedToday: memberNewCount,
    isUnlimited: false,
  };
}

export async function rollbackPersonalQuota(userId: string): Promise<void> {
  try {
    await getRedisClient().decr(KEYS.personalDaily(userId));
  } catch {
    console.error(`Failed to rollback personal quota for user ${userId}`);
  }
}

export async function rollbackWorkspaceQuota(
  userId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await Promise.all([
      redis.decr(KEYS.workspaceDaily(workspaceId)),
      redis.decr(KEYS.memberDaily(workspaceId, userId)),
    ]);
  } catch {
    console.error(`Failed to rollback workspace quota for user ${userId} in workspace ${workspaceId}`);
  }
}

export async function getPersonalQuotaUsage(
  userId: string,
  plan: UserPlan,
): Promise<{ usedToday: number; limit: number; remaining: number; resetAt: Date }> {
  const limits = personalLimits(plan);
  const raw = await getRedisClient().get(KEYS.personalDaily(userId));
  const used = raw ? parseInt(raw, 10) : 0;

  return {
    usedToday: used,
    limit: limits.dailyLimit,
    remaining: Math.max(0, limits.dailyLimit - used),
    resetAt: new Date(midnightUnix() * 1000),
  };
}

export async function getWorkspaceQuotaUsage(
  workspaceId: string,
  userId: string,
  plan: WorkspacePlan,
  memberCount: number,
  allMemberIds: string[],
): Promise<{
  workspaceUsedToday: number;
  workspaceRemaining: number | null;
  memberUsedToday: number;
  memberRemaining: number | null;
  isUnlimited: boolean;
  resetAt: Date;
  perMemberBreakdown: Array<{ userId: string; usedToday: number; remaining: number | null }>;
}> {
  const redis = getRedisClient();
  const limits = workspaceLimits(plan, memberCount);
  const resetAt = new Date(midnightUnix() * 1000);

  if (limits.isUnlimited) {
    return {
      workspaceUsedToday: 0,
      workspaceRemaining: null,
      memberUsedToday: 0,
      memberRemaining: null,
      isUnlimited: true,
      resetAt,
      perMemberBreakdown: [],
    };
  }

  const pipe = redis.pipeline();
  pipe.get(KEYS.workspaceDaily(workspaceId));
  for (const mid of allMemberIds) {
    pipe.get(KEYS.memberDaily(workspaceId, mid));
  }
  const results = await pipe.exec(); // [[err, val], [err, val], ...]

  const wsUsed = results?.[0]?.[1] ? parseInt(results[0][1] as string, 10) : 0;
  const wsRemaining =
    limits.dailyWorkspaceTotal !== null
      ? Math.max(0, limits.dailyWorkspaceTotal - wsUsed)
      : null;

  const perMemberBreakdown = allMemberIds.map((mid, i) => {
    const raw = results?.[i + 1]?.[1];
    const used = raw ? parseInt(raw as string, 10) : 0;
    return {
      userId: mid,
      usedToday: used,
      remaining:
        limits.dailyPerMember !== null
          ? Math.max(0, limits.dailyPerMember - used)
          : null,
    };
  });

  const myUsage = perMemberBreakdown.find((m) => m.userId === userId);

  return {
    workspaceUsedToday: wsUsed,
    workspaceRemaining: wsRemaining,
    memberUsedToday: myUsage?.usedToday ?? 0,
    memberRemaining: myUsage?.remaining ?? null,
    isUnlimited: false,
    resetAt,
    perMemberBreakdown,
  };
}