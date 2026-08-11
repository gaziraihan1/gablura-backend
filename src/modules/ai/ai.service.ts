import { createHash } from "node:crypto";
import type { z } from "zod";
import { aiComplete, isAiConfigured } from "../../lib/ai/gemini.client.js";
import { getRedisClient } from "../../redis/redis.client.js";
import {
  AiInvalidResponseError,
  AiMonthlyQuotaExceededError,
  AiServiceUnavailableError,
} from "../../errors/AppError.js";
import { AiAccess } from "./ai.access.js";
import { resolveAiLimits } from "./ai.ratelimit.js";
import { prisma } from "../../lib/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/index.js";
import {
  type AiFeature,
  type AiQuotaResponse,
  type AiUsageReport,
} from "./ai.types.js";
import {
  autocompleteOutputSchema,
  breakdownOutputSchema,
  commentAssistOutputSchema,
  dailyPlanOutputSchema,
  meetingSummaryOutputSchema,
  weeklyInsightsOutputSchema,
  type AutocompleteInput,
  type AutocompleteOutput,
  type BreakdownInput,
  type BreakdownOutput,
  type CommentAssistInput,
  type CommentAssistOutput,
  type DailyPlanInput,
  type DailyPlanOutput,
  type MeetingSummaryInput,
  type MeetingSummaryOutput,
  type WeeklyInsightsInput,
  type WeeklyInsightsOutput,
} from "./ai.validators.js";

/**
 * Feature prompts. Each one is short, data-minimal (only the fields the model
 * needs — never passwords, tokens, or unrelated PII) and forces strict JSON.
 */

const AUTOCOMPLETE_SYSTEM = `You are Focura's smart task-planning assistant. You turn a short task title into a well-structured task.
Respond with ONLY valid JSON matching the exact schema below. Use realistic, concise values. Do not invent dates more than 30 days out.`;

const BREAKDOWN_SYSTEM = `You are Focura's cognitive-planning assistant. You break a big goal into a sequence of small, energy-appropriate tasks.
Order tasks from easiest/lowest-energy to hardest/highest-energy so the user builds momentum.
Respond with ONLY valid JSON matching the exact schema below.`;

const COMMENT_ASSIST_SYSTEM = `You are Focura's team-comms writing assistant. Rewrite the user's message in the requested tone while keeping the exact same meaning.
Keep it under 2000 characters. Respond with ONLY valid JSON matching the exact schema below.`;

const DAILY_PLAN_SYSTEM = `You are Focura's daily planning assistant. You order a set of tasks into the best sequence for the day using energy types, priorities, due dates and estimated effort.
Consider: urgent/due-today tasks first, high-energy tasks in the user's peak windows, and never schedule more total hours than a realistic workday.
Respond with ONLY valid JSON matching the exact schema below.`;

const MEETING_SUMMARY_SYSTEM = `You are Focura's meeting-minutes assistant. Turn meeting details + notes into concise minutes and a short list of action items.
Only assign an action item to an attendee when the notes clearly indicate them. Keep the summary factual and under 4000 characters.
Respond with ONLY valid JSON matching the exact schema below.`;

const WEEKLY_INSIGHTS_SYSTEM = `You are Focura's productivity analyst. Given a workspace's weekly activity snapshot, write a concise weekly summary, up to 4 highlights (what went well), and up to 4 risks (burnout / deadline / workload signals) with a severity of low, medium or high.
Be specific, factual and actionable. Do not invent metrics that are not in the snapshot. Respond with ONLY valid JSON matching the exact schema below.`;

const PROMPT_CACHE_TTL_SECONDS = 60 * 60; // identical prompts cost 0
const TOKEN_BUDGET_ALERT_THRESHOLD = 0.8;

/**
 * Conservative per-model USD cost per 1M tokens — used ONLY to estimate
 * `AiUsageLog.costUsd` for reports. Never a billing ledger; the provider
 * invoice is the source of truth.
 */
const AI_COST_PER_1M_TOKENS_USD: Record<"lite" | "std" | "pro", number> = {
  lite: 1.0,
  std: 3.0,
  pro: 8.0,
};

interface RunFeatureOptions<T> {
  feature: AiFeature;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: "lite" | "std" | "pro";
  /** Scope id for token accounting — `ws:<id>` or `usr:<id>`. */
  scopeId: string;
  /** The authenticated user who initiated the call (for usage logging). */
  userId: string;
  /** Monthly token budget — hard pre-check plus the 80% soft-alert. */
  monthlyTokens: number;
  /** Per-plan output cap — enforced on the call and used for the estimate. */
  maxOutputTokens: number;
  /** Cache identical prompts (safe for deterministic, repeatable features). */
  cacheable?: boolean;
}

export const AiService = {
  async autocomplete(
    input: AutocompleteInput,
    userId: string,
  ): Promise<AutocompleteOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "tasks.autocomplete");

    const prompt = [
      `Task title: "${input.title}"`,
      input.energyType
        ? `The user plans to do this when their energy level is ${input.energyType}.`
        : null,
      "",
      'Return JSON:',
      '{',
      '  "description": "1-2 sentence description",',
      '  "priority": "URGENT|HIGH|MEDIUM|LOW",',
      '  "estimatedHours": number,',
      '  "dueDate": "YYYY-MM-DD or null",',
      '  "energyType": "LOW|MEDIUM|HIGH",',
      '  "intent": "EXECUTION|PLANNING|REVIEW|LEARNING|COMMUNICATION",',
      '  "subtasks": [{ "title": "string" }]',
      '}',
    ]
      .filter(Boolean)
      .join("\n");

    return runFeature<AutocompleteOutput>({
      feature: "tasks.autocomplete",
      system: AUTOCOMPLETE_SYSTEM,
      prompt,
      schema: autocompleteOutputSchema,
      model: "lite",
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
      cacheable: true,
    });
  },

  async breakdown(input: BreakdownInput, userId: string): Promise<BreakdownOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "goals.breakdown");

    const prompt = [
      `Big goal: "${input.goal}"`,
      input.energyType
        ? `The user's current energy level is ${input.energyType}. Match task energy levels accordingly.`
        : null,
      "",
      "Return JSON:",
      '{',
      '  "tasks": [{ "title": "string", "energyType": "LOW|MEDIUM|HIGH", "estimatedHours": number }],',
      '  "rationale": "one short sentence"',
      '}',
    ]
      .filter(Boolean)
      .join("\n");

    return runFeature<BreakdownOutput>({
      feature: "goals.breakdown",
      system: BREAKDOWN_SYSTEM,
      prompt,
      schema: breakdownOutputSchema,
      model: "std",
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
    });
  },

  async commentAssist(
    input: CommentAssistInput,
    userId: string,
  ): Promise<CommentAssistOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "comments.assist");

    const prompt = [
      `Tone: ${input.tone}`,
      `Original message: "${input.text}"`,
      "",
      "Return JSON:",
      '{ "text": "the rewritten message" }',
    ].join("\n");

    return runFeature<CommentAssistOutput>({
      feature: "comments.assist",
      system: COMMENT_ASSIST_SYSTEM,
      prompt,
      schema: commentAssistOutputSchema,
      model: "lite",
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
      cacheable: true,
    });
  },

  async planDaily(input: DailyPlanInput, userId: string): Promise<DailyPlanOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "plan.daily");

    const tasksText = input.tasks
      .map((task) => {
        const bits = [
          `id:${task.id}`,
          `title:${task.title}`,
          task.priority ? `priority:${task.priority}` : null,
          task.energyType ? `energy:${task.energyType}` : null,
          task.estimatedHours != null ? `hours:${task.estimatedHours}` : null,
          task.dueDate ? `due:${task.dueDate}` : null,
        ];
        return `- ${bits.filter(Boolean).join(" | ")}`;
      })
      .join("\n");

    const prompt = [
      `Date: ${input.date}`,
      "",
      "Tasks to schedule:",
      tasksText,
      "",
      "Return JSON:",
      '{',
      '  "plan": [{ "taskId": "must match a task id above", "order": 1, "reason": "why this slot" }],',
      '  "rationale": "one short sentence"',
      '}',
    ].join("\n");

    const result = await runFeature<DailyPlanOutput>({
      feature: "plan.daily",
      system: DAILY_PLAN_SYSTEM,
      prompt,
      schema: dailyPlanOutputSchema,
      model: "std",
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
    });

    return sanitizeDailyPlan(result, input.tasks);
  },

  async summarizeMeeting(
    input: MeetingSummaryInput,
    userId: string,
  ): Promise<MeetingSummaryOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "meetings.summarize");

    // Fetch the meeting record for context — only the fields the prompt needs.
    const meeting = await prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        title: true,
        description: true,
        workspaceId: true,
        attendees: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundError("Meeting not found");
    }
    // Always verify the caller belongs to the meeting's workspace — even when
    // `workspaceId` is omitted this prevents summarizing arbitrary meetings
    // (IDOR). The membership check also covers the mismatch case.
    await AiAccess.assertWorkspaceMember(userId, meeting.workspaceId);

    const attendeesText = meeting.attendees
      .map((a) => `${a.user.name} <${a.user.email}>`)
      .join(", ");

    const prompt = [
      `Meeting title: "${meeting.title}"`,
      meeting.description ? `Meeting description: "${meeting.description}"` : null,
      attendeesText ? `Attendees: ${attendeesText}` : null,
      input.notes ? `User notes: "${input.notes}"` : null,
      "",
      "Return JSON:",
      '{',
      '  "summary": "concise minutes",',
      '  "actionItems": [{ "text": "action", "assigneeEmail": "attendee email or null" }]',
      '}',
    ]
      .filter(Boolean)
      .join("\n");

    const result = await runFeature<MeetingSummaryOutput>({
      feature: "meetings.summarize",
      system: MEETING_SUMMARY_SYSTEM,
      prompt,
      schema: meetingSummaryOutputSchema,
      model: "std",
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
    });

    return sanitizeMeetingSummary(result, meeting.attendees.map((a) => a.user.email));
  },

  async weeklyInsights(
    input: WeeklyInsightsInput,
    userId: string,
  ): Promise<WeeklyInsightsOutput> {
    const { plan, limits } = await resolveAiLimits(input.workspaceId, userId);
    AiAccess.assertFeatureEnabled(plan, "insights.weekly");

    const snapshot = await buildWeeklySnapshot(input.workspaceId, input.week);

    const prompt = [
      "Workspace weekly snapshot (all numbers are real aggregates):",
      JSON.stringify(snapshot, null, 2),
      "",
      "Return JSON:",
      '{',
      '  "summary": "2-3 sentence weekly summary",',
      '  "highlights": [{ "title": "short headline", "detail": "optional supporting detail" }],',
      '  "risks": [{ "title": "short headline", "detail": "optional detail", "severity": "low|medium|high" }]',
      '}',
    ].join("\n");

    const result = await runFeature<WeeklyInsightsOutput>({
      feature: "insights.weekly",
      system: WEEKLY_INSIGHTS_SYSTEM,
      prompt,
      schema: weeklyInsightsOutputSchema,
      model: "pro", // BUSINESS-tier: most capable model for analysis
      scopeId: scopeId(input.workspaceId, userId),
      userId,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
    });

    return {
      summary: result.summary,
      highlights: result.highlights ?? [],
      risks: result.risks ?? [],
    };
  },

  /**
   * Aggregates `AiUsageLog` rows for a workspace over the last `days` days:
   * totals, per-feature and per-model breakdowns, and the 10 most recent
   * calls. Read-only — never consumes the AI budget. The caller must be a
   * workspace OWNER or ADMIN (enforced in the controller).
   */
  async getUsageReport(workspaceId: string, days: number): Promise<AiUsageReport> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const [byFeatureRows, byModelRows, recent] = await Promise.all([
      prisma.aiUsageLog.groupBy({
        by: ["feature"],
        where: { workspaceId, createdAt: { gte: start } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costUsd: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ["model"],
        where: { workspaceId, createdAt: { gte: start } },
        _count: { _all: true },
        _sum: { totalTokens: true, costUsd: true },
      }),
      prisma.aiUsageLog.findMany({
        where: { workspaceId, createdAt: { gte: start } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          feature: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          costUsd: true,
          createdAt: true,
        },
      }),
    ]);

    const total = byFeatureRows.reduce(
      (acc, row) => ({
        calls: acc.calls + row._count._all,
        inputTokens: acc.inputTokens + (row._sum.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (row._sum.outputTokens ?? 0),
        totalTokens: acc.totalTokens + (row._sum.totalTokens ?? 0),
        costUsd: acc.costUsd + Number(row._sum.costUsd ?? 0),
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
    );

    return {
      workspaceId,
      days,
      period: { start: start.toISOString(), end: end.toISOString() },
      total,
      byFeature: byFeatureRows
        .map((row) => ({
          feature: row.feature,
          calls: row._count._all,
          totalTokens: row._sum.totalTokens ?? 0,
          costUsd: Number(row._sum.costUsd ?? 0),
        }))
        .sort((a, b) => b.calls - a.calls),
      byModel: byModelRows
        .map((row) => ({
          model: row.model,
          calls: row._count._all,
          totalTokens: row._sum.totalTokens ?? 0,
          costUsd: Number(row._sum.costUsd ?? 0),
        }))
        .sort((a, b) => b.calls - a.calls),
      recent: recent.map((row) => ({
        id: row.id,
        feature: row.feature,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd != null ? Number(row.costUsd) : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },

  async getQuota(opts: {
    userId: string;
    workspaceId?: string;
  }): Promise<AiQuotaResponse> {
    const { plan, limits, overrides, defaults } = await resolveAiLimits(
      opts.workspaceId,
      opts.userId,
    );
    const id = scopeId(opts.workspaceId, opts.userId);

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);
    const resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    let usedToday = 0;
    let tokensUsedToday = 0;
    let tokensUsedThisMonth = 0;

    try {
      const redis = getRedisClient();
      const [daily, tokensDaily, tokensMonth] = await Promise.all([
        redis.get(`focura:ai:q:daily:${today}:${id}`),
        redis.get(`focura:ai:q:tokens:daily:${today}:${id}`),
        redis.get(`focura:ai:q:tokens:month:${month}:${id}`),
      ]);
      usedToday = Number(daily ?? 0);
      tokensUsedToday = Number(tokensDaily ?? 0);
      tokensUsedThisMonth = Number(tokensMonth ?? 0);
    } catch (error) {
      // Quota read must never fail the request — defaults above are safe.
      console.error("[AiService] quota read failed:", error);
    }

    return {
      plan,
      dailyLimit: limits.daily,
      usedToday,
      remaining: Math.max(0, limits.daily - usedToday),
      burstPerMinute: limits.burstPerMinute,
      hourly: limits.hourly,
      dailyTokens: limits.dailyTokens,
      monthlyTokens: limits.monthlyTokens,
      maxOutputTokens: limits.maxOutputTokens,
      tokensUsedToday,
      tokensUsedThisMonth,
      features: limits.features,
      resetAt,
      defaults,
      overrides,
    };
  },

};

async function runFeature<T>(opts: RunFeatureOptions<T>): Promise<T> {
    if (!isAiConfigured()) {
      throw new AiServiceUnavailableError(
        "AI is not configured on this server. Please contact support.",
      );
    }

    const redis = getRedisClient();
    const cacheKey = opts.cacheable
      ? `focura:ai:cache:${createHash("sha256")
          .update(`${opts.feature}:${opts.prompt}`)
          .digest("hex")}`
      : null;

    // Dedupe & cache identical prompts so repeated calls cost 0 tokens.
    if (cacheKey) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = opts.schema.safeParse(JSON.parse(cached));
          if (parsed.success) return parsed.data;
        }
      } catch {
        // Cache read/parse failure → fall through to a live call.
      }
    }

    // Hard monthly budget pre-check — the worst-case cost of this call must fit
    // inside the remaining monthly token budget (fail-closed on Redis errors).
    await assertMonthlyBudget(
      opts.scopeId,
      opts.maxOutputTokens,
      opts.prompt,
      opts.monthlyTokens,
    );

    const result = await aiComplete(opts.prompt, {
      model: opts.model,
      system: opts.system,
      maxOutputTokens: opts.maxOutputTokens,
    });

    const data = parseJsonOutput(opts.schema, result.text);

    if (cacheKey) {
      try {
        await redis.set(cacheKey, JSON.stringify(data), "EX", PROMPT_CACHE_TTL_SECONDS);
      } catch {
        // Caching is best-effort — never fail the feature over a cache write.
      }
    }

    await recordTokenUsage(
      opts.scopeId,
      result.usage.inputTokens + result.usage.outputTokens,
      opts.monthlyTokens,
    );

    // Audit trail for billing reports — fire-and-forget, never fails the request.
    void persistUsageLog({
      scopeId: opts.scopeId,
      userId: opts.userId,
      feature: opts.feature,
      model: opts.model ?? "lite",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Aggregates one week (defaults to the current week starting Monday) of
 * workspace activity: task throughput, overdue load, focus time, energy
 * levels and per-member workload. The snapshot is data-minimal — only counts
 * and titles, never raw content or PII beyond member names.
 */
async function buildWeeklySnapshot(
  workspaceId: string,
  week?: string,
): Promise<Record<string, unknown>> {
  const weekStart = parseWeekStart(week);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const memberIds = await prisma.workspaceMember
    .findMany({
      where: { workspaceId },
      select: { userId: true },
    })
    .then((rows) => rows.map((r) => r.userId));

  const [
    createdThisWeek,
    completedThisWeek,
    overdueActive,
    dueThisWeek,
    focusAgg,
    energyAgg,
    taskGrouped,
    workloadRows,
  ] = await Promise.all([
    prisma.task.count({
      where: { workspaceId, createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.task.count({
      where: {
        workspaceId,
        status: "COMPLETED",
        completedAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.task.count({
      where: {
        workspaceId,
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        dueDate: { lt: now },
      },
    }),
    prisma.task.count({
      where: {
        workspaceId,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueDate: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.focusSession.aggregate({
      where: {
        userId: { in: memberIds },
        completed: true,
        startedAt: { gte: weekStart, lt: weekEnd },
      },
      _count: { id: true },
      _sum: { duration: true },
    }),
    prisma.energyLevel.aggregate({
      where: {
        userId: { in: memberIds },
        date: { gte: weekStart, lt: weekEnd },
      },
      _avg: { energyLevel: true },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { status: true },
    }),
    // Per-member active workload — top 5 by open tasks (burnout signal).
    prisma.taskAssignee.groupBy({
      by: ["userId"],
      where: {
        userId: { in: memberIds },
        task: {
          workspaceId,
          status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        },
      },
      _count: { taskId: true },
      orderBy: { _count: { taskId: "desc" } },
      take: 5,
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of taskGrouped) statusCounts[row.status] = row._count.status;

  // Resolve names only for the top-5 user ids (single round-trip).
  const workloadUsers = await prisma.user.findMany({
    where: { id: { in: workloadRows.map((row) => row.userId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(workloadUsers.map((u) => [u.id, u.name]));

  const workload = workloadRows.map((row) => ({
    member: nameById.get(row.userId) ?? "Unknown",
    openTasks: row._count.taskId,
  }));

  return {
    weekStart: toLocalDateString(weekStart),
    members: memberIds.length,
    tasks: {
      createdThisWeek,
      completedThisWeek,
      overdueActive,
      dueThisWeek,
      byStatus: statusCounts,
    },
    focus: {
      completedSessions: focusAgg._count.id,
      totalMinutes: focusAgg._sum.duration ?? 0,
    },
    energy: {
      avgLevel: energyAgg._avg.energyLevel
        ? Math.round(energyAgg._avg.energyLevel * 10) / 10
        : null,
      loggedDays: energyAgg._count.id,
    },
    topWorkload: workload,
  };
}

/** Week start = Monday 00:00 local, or the given YYYY-MM-DD if provided. */
function parseWeekStart(week?: string): Date {
  if (week) {
    const date = new Date(`${week}T00:00:00`);
    // Round-trip against local components — rejects calendar-invalid dates like
    // "2026-02-30" that the regex validator cannot catch, and stays timezone-
    // safe (comparing toISOString would shift the date for UTC-offset zones).
    if (!Number.isNaN(date.getTime()) && toLocalDateString(date) === week) {
      return date;
    }
    throw new ValidationError(
      "The `week` field must be a valid YYYY-MM-DD date.",
    );
  }
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Local (not UTC) YYYY-MM-DD — matches the local aggregation boundaries. */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The LLM must only reference task ids the client actually sent. Unknown ids
 * are dropped and the remaining plan is re-numbered by `order`.
 */
function sanitizeDailyPlan(
  result: DailyPlanOutput,
  inputTasks: { id: string }[],
): DailyPlanOutput {
  const knownIds = new Set(inputTasks.map((task) => task.id));
  const seen = new Set<string>();
  const kept = result.plan
    // Keep known ids, once each — the LLM must not schedule the same task twice.
    .filter((entry) => {
      if (!knownIds.has(entry.taskId) || seen.has(entry.taskId)) return false;
      seen.add(entry.taskId);
      return true;
    })
    .sort((a, b) => a.order - b.order)
    .map((entry, index) => ({ ...entry, order: index + 1 }));

  if (kept.length === 0 && result.plan.length > 0) {
    // Fall back to the input order rather than returning an empty plan.
    return {
      plan: inputTasks.map((task, index) => ({
        taskId: task.id,
        order: index + 1,
        reason: "Scheduled in the order you provided.",
      })),
      rationale: result.rationale,
    };
  }

  return { plan: kept, rationale: result.rationale };
}

/** Action items may only reference real attendee emails. */
function sanitizeMeetingSummary(
  result: MeetingSummaryOutput,
  attendeeEmails: string[],
): MeetingSummaryOutput {
  const allowed = new Set(attendeeEmails.map((email) => email.toLowerCase()));
  return {
    summary: result.summary,
    actionItems: (result.actionItems ?? []).map((item) => {
      if (!item.assigneeEmail) return item;
      return allowed.has(item.assigneeEmail.toLowerCase())
        ? item
        : { text: item.text, assigneeEmail: null };
    }),
  };
}

function scopeId(workspaceId: string | undefined, userId: string): string {
  return workspaceId ? `ws:${workspaceId}` : `usr:${userId}`;
}

/** Validates raw LLM text as JSON against the feature schema. */
function parseJsonOutput<T>(schema: z.ZodType<T>, text: string): T {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new AiInvalidResponseError(
      "The AI service returned malformed output. Please try again.",
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.error("[AiService] LLM output failed validation:", parsed.error.issues);
    throw new AiInvalidResponseError(
      "The AI service returned an unexpected response. Please try again.",
    );
  }
  return parsed.data;
}

/**
 * Extracts a JSON value from an LLM response, tolerating markdown code fences
 * and stray prose around the JSON blob.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("No JSON payload found in AI response");
}

/** Increments daily + monthly token counters and warns when nearing the budget. */
async function recordTokenUsage(
  scopeId: string,
  totalTokens: number,
  monthlyBudget: number,
): Promise<void> {
  if (totalTokens <= 0) return;

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);

  try {
    const redis = getRedisClient();
    const dailyKey = `focura:ai:q:tokens:daily:${day}:${scopeId}`;
    const monthlyKey = `focura:ai:q:tokens:month:${month}:${scopeId}`;

    const pipeline = redis.pipeline();
    pipeline.incrby(dailyKey, totalTokens);
    pipeline.expire(dailyKey, 60 * 60 * 25);
    pipeline.incrby(monthlyKey, totalTokens);
    pipeline.expire(monthlyKey, 60 * 60 * 24 * 32);
    await pipeline.exec();

    // Soft budget alert: warn once the scope crosses 80% of its monthly budget.
    const monthlyUsed = Number((await redis.get(monthlyKey)) ?? 0);
    if (monthlyUsed > monthlyBudget * TOKEN_BUDGET_ALERT_THRESHOLD) {
      console.warn(
        `[AiService] AI token budget nearly exhausted for ${scopeId}: ` +
          `${monthlyUsed}/${monthlyBudget} monthly tokens.`,
      );
    }
  } catch (error) {
    console.error("[AiService] token accounting failed:", error);
  }
}

/**
 * Hard monthly token pre-check (Phase 4). Estimates the worst-case cost of the
 * call (input chars → tokens, plus the plan's full output cap) and rejects with
 * 429 when the remaining budget cannot cover it. Fail-closed: if the counter
 * cannot be read we refuse the call rather than risk overspend.
 */
async function assertMonthlyBudget(
  scopeId: string,
  maxOutputTokens: number,
  prompt: string,
  monthlyBudget: number,
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const key = `focura:ai:q:tokens:month:${month}:${scopeId}`;

  let usedThisMonth: number;
  try {
    usedThisMonth = Number((await getRedisClient().get(key)) ?? 0);
  } catch (error) {
    console.error("[AiService] monthly budget read failed:", error);
    throw new AiServiceUnavailableError(
      "AI quota service unavailable. Please try again later.",
    );
  }

  const estimatedTokens =
    Math.ceil(prompt.length / 4) + maxOutputTokens; // ~4 chars/token + worst-case output
  if (usedThisMonth + estimatedTokens > monthlyBudget) {
    throw new AiMonthlyQuotaExceededError(secondsUntilNextMonth());
  }
}

/**
 * Writes one `AiUsageLog` row per successful Gemini call. Fire-and-forget: any
 * DB failure is logged and swallowed so billing visibility never breaks UX.
 */
async function persistUsageLog(opts: {
  scopeId: string;
  userId: string;
  feature: AiFeature;
  model: "lite" | "std" | "pro";
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const totalTokens = opts.inputTokens + opts.outputTokens;
  try {
    await prisma.aiUsageLog.create({
      data: {
        workspaceId: opts.scopeId.startsWith("ws:") ? opts.scopeId.slice(3) : null,
        userId: opts.userId,
        feature: opts.feature,
        model: opts.model,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        totalTokens,
        costUsd: estimateCostUsd(opts.model, totalTokens),
      },
    });
  } catch (error) {
    console.error("[AiService] usage log write failed:", error);
  }
}

/** Estimated USD cost for a call — reporting only, never a billing ledger. */
function estimateCostUsd(
  model: "lite" | "std" | "pro",
  totalTokens: number,
): number {
  const cost = (totalTokens / 1_000_000) * AI_COST_PER_1M_TOKENS_USD[model];
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Seconds until the start of the next month (for the 429 retryAfter). */
function secondsUntilNextMonth(): number {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(60, Math.ceil((nextMonth.getTime() - now.getTime()) / 1000));
}
