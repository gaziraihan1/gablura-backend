import { describe, it, expect, vi, beforeEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Hoisted mocks
// ═══════════════════════════════════════════════════════════════════════════════

const mockAiClient = vi.hoisted(() => ({
  aiComplete: vi.fn(),
  isAiConfigured: vi.fn(),
}));

const mockGetRedisClient = vi.hoisted(() => vi.fn());

const mockPrisma = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn(), findMany: vi.fn() },
  meeting: { findUnique: vi.fn() },
  task: { count: vi.fn(), groupBy: vi.fn() },
  taskAssignee: { groupBy: vi.fn() },
  focusSession: { aggregate: vi.fn() },
  energyLevel: { aggregate: vi.fn() },
  user: { findMany: vi.fn() },
  aiUsageLog: { create: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
}));

const mockBillingService = vi.hoisted(() => ({
  getUserHighestPlan: vi.fn(),
}));

vi.mock("../../../lib/ai/gemini.client.js", () => mockAiClient);
vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: mockGetRedisClient,
}));
vi.mock("../../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../../modules/billing/billing.service.js", () => ({
  BillingService: mockBillingService,
}));

// ═══════════════════════════════════════════════════════════════════════════════

import { AiService } from "../../../modules/ai/ai.service.js";
import { AiAccess } from "../../../modules/ai/ai.access.js";
import {
  AiInvalidResponseError,
  AiMonthlyQuotaExceededError,
  AiServiceUnavailableError,
  ForbiddenError,
  ValidationError,
} from "../../../errors/AppError.js";
import type { AutocompleteOutput, BreakdownOutput } from "../../../modules/ai/ai.validators.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function createRedisMock() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    incrby: vi.fn(async (key: string, n: number) => {
      const next = Number(store.get(key) ?? 0) + n;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn(() => ({
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  };
}

const VALID_AUTOCOMPLETE_JSON: AutocompleteOutput = {
  description: "Investigate the redirect and fix it on mobile.",
  priority: "HIGH",
  estimatedHours: 2,
  dueDate: "2026-08-15",
  energyType: "MEDIUM",
  intent: "EXECUTION",
  subtasks: [{ title: "Reproduce" }, { title: "Deploy" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAiClient.isAiConfigured.mockReturnValue(true);
  mockAiClient.aiComplete.mockResolvedValue({
    text: JSON.stringify(VALID_AUTOCOMPLETE_JSON),
    model: "gemini-2.5-flash-lite",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "PRO" });
  // Default: the caller is a member of every workspace they touch.
  mockPrisma.workspaceMember.findUnique.mockResolvedValue({ id: "membership" });
  // Weekly snapshot defaults (zero activity).
  mockPrisma.workspaceMember.findMany.mockResolvedValue([]);
  mockPrisma.task.count.mockResolvedValue(0);
  mockPrisma.task.groupBy.mockResolvedValue([]);
  mockPrisma.taskAssignee.groupBy.mockResolvedValue([]);
  mockPrisma.focusSession.aggregate.mockResolvedValue({
    _count: { id: 0 },
    _sum: { duration: null },
  });
  mockPrisma.energyLevel.aggregate.mockResolvedValue({
    _avg: { energyLevel: null },
    _count: { id: 0 },
  });
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.aiUsageLog.create.mockResolvedValue({ id: "log-1" });
  mockPrisma.aiUsageLog.groupBy.mockResolvedValue([]);
  mockPrisma.aiUsageLog.findMany.mockResolvedValue([]);
  mockPrisma.meeting.findUnique.mockResolvedValue({
    title: "Q3 Roadmap Sync",
    description: "Review the roadmap for next quarter.",
    workspaceId: "ws-1",
    attendees: [
      { user: { name: "Alice", email: "alice@example.com" } },
      { user: { name: "Bob", email: "bob@example.com" } },
    ],
  });
  mockBillingService.getUserHighestPlan.mockResolvedValue("FREE");
  mockGetRedisClient.mockReturnValue(createRedisMock());
});

// ═══════════════════════════════════════════════════════════════════════════════

describe("AiService.autocomplete", () => {
  it("returns a validated suggestion and records token usage", async () => {
    const redis = createRedisMock();
    mockGetRedisClient.mockReturnValue(redis);

    const result = await AiService.autocomplete(
      { workspaceId: "ws-1", title: "Fix login bug" },
      "user-1",
    );

    expect(result).toEqual(VALID_AUTOCOMPLETE_JSON);
    expect(mockAiClient.aiComplete).toHaveBeenCalledTimes(1);
    // Token accounting: pipeline.incrby invoked twice (daily + monthly).
    expect(redis.pipeline).toHaveBeenCalled();
    // Prompt dedupe cache write happened.
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^focura:ai:cache:/),
      expect.any(String),
      "EX",
      3600,
    );
  });

  it("parses JSON wrapped in markdown code fences", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: `Here you go:\n\`\`\`json\n${JSON.stringify(VALID_AUTOCOMPLETE_JSON)}\n\`\`\``,
      model: "lite",
      usage: { inputTokens: 5, outputTokens: 3 },
    });

    const result = await AiService.autocomplete(
      { title: "Fix login bug" },
      "user-1",
    );

    expect(result).toEqual(VALID_AUTOCOMPLETE_JSON);
  });

  it("throws AI_INVALID_RESPONSE when the LLM returns malformed JSON", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: "Sorry, I cannot help with that.",
      model: "lite",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      AiService.autocomplete({ title: "Fix login bug" }, "user-1"),
    ).rejects.toThrow(AiInvalidResponseError);
  });

  it("throws AI_INVALID_RESPONSE when the LLM output fails validation", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({ description: "x", priority: "SUPER_URGENT" }),
      model: "lite",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      AiService.autocomplete({ title: "Fix login bug" }, "user-1"),
    ).rejects.toThrow(AiInvalidResponseError);
  });

  it("throws AI_SERVICE_UNAVAILABLE when AI is not configured", async () => {
    mockAiClient.isAiConfigured.mockReturnValue(false);

    await expect(
      AiService.autocomplete({ title: "Fix login bug" }, "user-1"),
    ).rejects.toThrow(AiServiceUnavailableError);
  });

  it("serves a cached response without calling the model again", async () => {
    const redis = createRedisMock();
    mockGetRedisClient.mockReturnValue(redis);

    await AiService.autocomplete({ title: "Fix login bug" }, "user-1");
    expect(mockAiClient.aiComplete).toHaveBeenCalledTimes(1);

    // Second identical call hits the prompt cache.
    await AiService.autocomplete({ title: "Fix login bug" }, "user-1");
    expect(mockAiClient.aiComplete).toHaveBeenCalledTimes(1);
  });
});

describe("AiService.breakdown", () => {
  it("returns a validated task breakdown", async () => {
    const breakdown: BreakdownOutput = {
      tasks: [
        { title: "Outline the plan", energyType: "LOW", estimatedHours: 1 },
        { title: "Build the core", energyType: "HIGH", estimatedHours: 4 },
      ],
      rationale: "Start small.",
    };
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify(breakdown),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 20, outputTokens: 10 },
    });

    const result = await AiService.breakdown(
      { workspaceId: "ws-1", goal: "Launch the mobile app" },
      "user-1",
    );

    expect(result).toEqual(breakdown);
  });

  it("uses the user plan for personal goals", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        tasks: [{ title: "Do research", energyType: "LOW", estimatedHours: 1 }],
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await AiService.breakdown({ goal: "Learn TypeScript deeply" }, "user-1");

    expect(mockBillingService.getUserHighestPlan).toHaveBeenCalledWith("user-1");
  });
});

describe("AiService.commentAssist", () => {
  it("rewrites a comment in the requested tone", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({ text: "Could you please take a look at the PR?" }),
      model: "lite",
      usage: { inputTokens: 3, outputTokens: 2 },
    });

    const result = await AiService.commentAssist(
      { text: "check pr pls", tone: "professional" },
      "user-1",
    );

    expect(result.text).toBe("Could you please take a look at the PR?");
  });
});

describe("AiService.planDaily", () => {
  it("returns a sanitized, re-numbered day plan", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        plan: [
          { taskId: "t2", order: 2, reason: "Low energy filler" },
          { taskId: "t1", order: 1, reason: "Urgent, due today" },
        ],
        rationale: "Front-load the urgent work.",
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 30, outputTokens: 12 },
    });

    const result = await AiService.planDaily(
      {
        workspaceId: "ws-1",
        date: "2026-08-10",
        tasks: [
          { id: "t1", title: "Fix login bug", priority: "URGENT", energyType: "HIGH", estimatedHours: 2 },
          { id: "t2", title: "Reply to emails", priority: "LOW", energyType: "LOW" },
        ],
      },
      "user-1",
    );

    expect(result.plan).toEqual([
      { taskId: "t1", order: 1, reason: "Urgent, due today" },
      { taskId: "t2", order: 2, reason: "Low energy filler" },
    ]);
    expect(result.rationale).toBe("Front-load the urgent work.");
  });

  it("drops hallucinated task ids and re-orders by `order`", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        plan: [
          { taskId: "t1", order: 2, reason: "Do first" },
          { taskId: "FAKE_ID", order: 1, reason: "Nope" },
          { taskId: "t2", order: 3, reason: "Do second" },
        ],
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    const result = await AiService.planDaily(
      {
        workspaceId: "ws-1",
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "A" }, { id: "t2", title: "B" }],
      },
      "user-1",
    );

    expect(result.plan.map((e) => e.taskId)).toEqual(["t1", "t2"]);
    expect(result.plan.map((e) => e.order)).toEqual([1, 2]);
  });

  it("dedupes duplicate task ids from the LLM", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        plan: [
          { taskId: "t1", order: 1, reason: "First" },
          { taskId: "t1", order: 2, reason: "Again?!" },
          { taskId: "t2", order: 3, reason: "Second" },
        ],
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    const result = await AiService.planDaily(
      {
        workspaceId: "ws-1",
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "A" }, { id: "t2", title: "B" }],
      },
      "user-1",
    );

    expect(result.plan.map((e) => e.taskId)).toEqual(["t1", "t2"]);
  });

  it("falls back to the input order when the AI returns no valid ids", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        plan: [{ taskId: "NOPE", order: 1, reason: "x" }],
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    const result = await AiService.planDaily(
      {
        workspaceId: "ws-1",
        date: "2026-08-10",
        tasks: [{ id: "t1", title: "A" }, { id: "t2", title: "B" }],
      },
      "user-1",
    );

    expect(result.plan.map((e) => e.taskId)).toEqual(["t1", "t2"]);
  });

  it("gates plan.daily off FREE plans", async () => {
    // Distinct id avoids the module-level plan cache populated by earlier tests.
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    await expect(
      AiService.planDaily(
        {
          workspaceId: "ws-free-gate-daily",
          date: "2026-08-10",
          tasks: [{ id: "t1", title: "A" }],
        },
        "user-1",
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("AiService.summarizeMeeting", () => {
  it("summarizes a meeting and keeps only real attendee emails", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        summary: "Team agreed on the Q3 roadmap.",
        actionItems: [
          { text: "Draft budget", assigneeEmail: "alice@example.com" },
          { text: "Check with marketing", assigneeEmail: "marketing@example.com" },
        ],
      }),
      model: "gemini-2.5-flash",
      usage: { inputTokens: 40, outputTokens: 15 },
    });

    const result = await AiService.summarizeMeeting(
      { workspaceId: "ws-1", meetingId: "m1", notes: "We need the budget by Friday." },
      "user-1",
    );

    expect(result.summary).toBe("Team agreed on the Q3 roadmap.");
    expect(result.actionItems).toEqual([
      { text: "Draft budget", assigneeEmail: "alice@example.com" },
      { text: "Check with marketing", assigneeEmail: null },
    ]);
    expect(mockPrisma.meeting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1" } }),
    );
  });

  it("throws NotFound when the meeting does not exist", async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue(null);

    await expect(
      AiService.summarizeMeeting(
        { workspaceId: "ws-1", meetingId: "m1" },
        "user-1",
      ),
    ).rejects.toThrow(/Meeting not found/);
  });

  it("throws Forbidden when the caller is not a member of the meeting's workspace", async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue({
      title: "Other",
      workspaceId: "ws-OTHER",
      attendees: [],
    });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(
      AiService.summarizeMeeting({ meetingId: "m1" }, "user-1"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("enforces membership even when workspaceId is omitted (no IDOR)", async () => {
    mockPrisma.meeting.findUnique.mockResolvedValue({
      title: "Secret",
      workspaceId: "ws-SECRET",
      attendees: [{ user: { name: "Alice", email: "alice@example.com" } }],
    });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(
      AiService.summarizeMeeting({ meetingId: "m1" }, "user-1"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("gates meetings.summarize off FREE plans", async () => {
    // Personal scope (no workspaceId) → resolves via getUserHighestPlan → FREE.
    mockBillingService.getUserHighestPlan.mockResolvedValue("FREE");

    await expect(
      AiService.summarizeMeeting({ meetingId: "m1" }, "user-1"),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("AiService.weeklyInsights", () => {
  it("aggregates the week snapshot and returns validated insights", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });
    mockPrisma.workspaceMember.findMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ]);
    // task.count: created / completed / overdue / due-this-week
    mockPrisma.task.count.mockImplementation(async ({ where }: { where: any }) => {
      if (where.completedAt) return 12; // completed this week
      if (where.dueDate) {
        if (where.dueDate.lt) return 3; // overdue
        return 8; // due this week
      }
      return 20; // created this week
    });
    mockPrisma.focusSession.aggregate.mockResolvedValue({
      _count: { id: 9 },
      _sum: { duration: 540 },
    });
    mockPrisma.energyLevel.aggregate.mockResolvedValue({
      _avg: { energyLevel: 3.6 },
      _count: { id: 14 },
    });
    mockPrisma.task.groupBy.mockResolvedValue([
      { status: "TODO", _count: { status: 5 } },
      { status: "COMPLETED", _count: { status: 12 } },
    ]);
    mockPrisma.taskAssignee.groupBy.mockResolvedValue([
      { userId: "u1", _count: { taskId: 9 } },
      { userId: "u2", _count: { taskId: 3 } },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        summary: "Solid week — 12 tasks completed across the team.",
        highlights: [{ title: "High throughput", detail: "12 tasks completed" }],
        risks: [
          { title: "Alice is overloaded", detail: "9 open tasks", severity: "high" },
        ],
      }),
      model: "gemini-2.5-pro",
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await AiService.weeklyInsights(
      { workspaceId: "ws-business-weekly", week: "2026-08-03" },
      "user-1",
    );

    expect(result.summary).toBe("Solid week — 12 tasks completed across the team.");
    expect(result.highlights).toHaveLength(1);
    expect(result.risks![0]).toMatchObject({ severity: "high" });
    // The prompt must carry the real aggregated snapshot.
    expect(mockAiClient.aiComplete).toHaveBeenCalledWith(
      expect.stringContaining("totalMinutes"),
      expect.anything(),
    );
    // BUSINESS tier uses the most capable ("pro") model.
    expect(mockAiClient.aiComplete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: "pro" }),
    );
  });

  it("returns empty arrays when the LLM omits highlights or risks", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({ summary: "Quiet week." }),
      model: "gemini-2.5-pro",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await AiService.weeklyInsights(
      { workspaceId: "ws-business-weekly" },
      "user-1",
    );

    expect(result.summary).toBe("Quiet week.");
    expect(result.highlights).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it("rejects calendar-invalid week values instead of falling back", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });

    await expect(
      AiService.weeklyInsights(
        { workspaceId: "ws-business-week", week: "2026-02-30" },
        "user-1",
      ),
    ).rejects.toThrow(ValidationError);
    // No aggregation runs for a rejected week.
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
  });

  it("aggregates exactly the requested week window", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({
        summary: "Week done.",
        highlights: [],
        risks: [],
      }),
      model: "gemini-2.5-pro",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const weekStart = new Date("2026-08-03T00:00:00");
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    await AiService.weeklyInsights(
      { workspaceId: "ws-business-boundary", week: "2026-08-03" },
      "user-1",
    );

    expect(mockPrisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-business-boundary",
          createdAt: { gte: weekStart, lt: weekEnd },
        }),
      }),
    );
    expect(mockPrisma.focusSession.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startedAt: { gte: weekStart, lt: weekEnd },
        }),
      }),
    );
  });

  it("gates insights.weekly off PRO and FREE plans", async () => {
    // Distinct id avoids the module-level plan cache populated by earlier tests.
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "PRO" });

    await expect(
      AiService.weeklyInsights(
        { workspaceId: "ws-pro-gate-weekly", week: "2026-08-03" },
        "user-1",
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("AiService — monthly budget pre-check (Phase 4)", () => {
  it("rejects with AI_MONTHLY_QUOTA_EXCEEDED when the budget cannot cover the call", async () => {
    const redis = createRedisMock();
    const month = new Date().toISOString().slice(0, 7);
    await redis.set(`focura:ai:q:tokens:month:${month}:ws:ws-budget-cap`, "3999000");
    mockGetRedisClient.mockReturnValue(redis);

    await expect(
      AiService.autocomplete({ workspaceId: "ws-budget-cap", title: "Fix login bug" }, "user-1"),
    ).rejects.toThrow(AiMonthlyQuotaExceededError);
    // The LLM must never be called when the pre-check rejects.
    expect(mockAiClient.aiComplete).not.toHaveBeenCalled();
  });

  it("lets calls through when the remaining budget covers the estimate", async () => {
    const redis = createRedisMock();
    const month = new Date().toISOString().slice(0, 7);
    await redis.set(`focura:ai:q:tokens:month:${month}:ws:ws-budget-ok`, "1000");
    mockGetRedisClient.mockReturnValue(redis);

    await expect(
      AiService.autocomplete({ workspaceId: "ws-budget-ok", title: "Fix login bug" }, "user-1"),
    ).resolves.toEqual(VALID_AUTOCOMPLETE_JSON);
  });

  it("fails closed (503) when the monthly budget cannot be read", async () => {
    const redis = createRedisMock();
    redis.get.mockRejectedValue(new Error("redis down"));
    mockGetRedisClient.mockReturnValue(redis);

    await expect(
      AiService.autocomplete({ title: "Fix login bug" }, "user-1"),
    ).rejects.toThrow(AiServiceUnavailableError);
  });
});

describe("AiService — usage log (Phase 4)", () => {
  it("persists an AiUsageLog row after a successful call", async () => {
    await AiService.autocomplete({ workspaceId: "ws-1", title: "Fix login bug" }, "user-1");

    expect(mockPrisma.aiUsageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        feature: "tasks.autocomplete",
        model: "lite",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: expect.any(Number),
      }),
    });
  });

  it("records personal (workspace-less) calls with a null workspaceId", async () => {
    mockAiClient.aiComplete.mockResolvedValue({
      text: JSON.stringify({ text: "Could you please check the PR?" }),
      model: "gemini-2.5-flash-lite",
      usage: { inputTokens: 3, outputTokens: 2 },
    });

    await AiService.commentAssist(
      { text: "check pr pls", tone: "professional" },
      "user-1",
    );

    expect(mockPrisma.aiUsageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: null,
        userId: "user-1",
        feature: "comments.assist",
      }),
    });
  });

  it("never fails the request when the usage-log write fails", async () => {
    mockPrisma.aiUsageLog.create.mockRejectedValue(new Error("db down"));

    await expect(
      AiService.autocomplete({ workspaceId: "ws-1", title: "Fix login bug" }, "user-1"),
    ).resolves.toEqual(VALID_AUTOCOMPLETE_JSON);
  });
});

describe("AiService.getUsageReport", () => {
  it("aggregates totals, per-feature and per-model breakdowns, and recent rows", async () => {
    mockPrisma.aiUsageLog.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by[0] === "feature") {
        return [
          {
            feature: "tasks.autocomplete",
            _count: { _all: 8 },
            _sum: { inputTokens: 400, outputTokens: 200, totalTokens: 600, costUsd: 0.0006 },
          },
          {
            feature: "goals.breakdown",
            _count: { _all: 2 },
            _sum: { inputTokens: 300, outputTokens: 100, totalTokens: 400, costUsd: 0.0012 },
          },
        ];
      }
      return [
        { model: "lite", _count: { _all: 8 }, _sum: { totalTokens: 600, costUsd: 0.0006 } },
        { model: "std", _count: { _all: 2 }, _sum: { totalTokens: 400, costUsd: 0.0012 } },
      ];
    });
    mockPrisma.aiUsageLog.findMany.mockResolvedValue([
      {
        id: "l1",
        feature: "tasks.autocomplete",
        model: "lite",
        inputTokens: 50,
        outputTokens: 25,
        totalTokens: 75,
        costUsd: 0.000075,
        createdAt: new Date("2026-08-09T10:00:00Z"),
      },
    ]);

    const report = await AiService.getUsageReport("ws-1", 30);

    expect(report.workspaceId).toBe("ws-1");
    expect(report.days).toBe(30);
    expect(report.total.calls).toBe(10);
    expect(report.total.inputTokens).toBe(700);
    expect(report.total.outputTokens).toBe(300);
    expect(report.total.totalTokens).toBe(1000);
    expect(report.total.costUsd).toBeCloseTo(0.0018, 5);
    expect(report.byFeature[0]).toMatchObject({ feature: "tasks.autocomplete", calls: 8 });
    expect(report.byFeature[1]).toMatchObject({ feature: "goals.breakdown", calls: 2 });
    expect(report.byModel).toHaveLength(2);
    expect(report.recent[0]).toMatchObject({
      id: "l1",
      feature: "tasks.autocomplete",
      totalTokens: 75,
      costUsd: 0.000075,
      createdAt: "2026-08-09T10:00:00.000Z",
    });
    // The look-back window is scoped to the workspace.
    expect(mockPrisma.aiUsageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
  });

  it("returns zeroed totals when there is no usage", async () => {
    const report = await AiService.getUsageReport("ws-1", 7);

    expect(report.total).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
    expect(report.byFeature).toEqual([]);
    expect(report.recent).toEqual([]);
  });
});

describe("AiService.getQuota", () => {
  it("reports usage for a workspace scope", async () => {
    const redis = createRedisMock();
    const today = new Date().toISOString().slice(0, 10);
    await redis.set(`focura:ai:q:daily:${today}:ws:ws-quota-free`, "10");
    await redis.set(`focura:ai:q:tokens:daily:${today}:ws:ws-quota-free`, "500");
    mockGetRedisClient.mockReturnValue(redis);
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });

    const quota = await AiService.getQuota({ userId: "user-1", workspaceId: "ws-quota-free" });

    expect(quota.plan).toBe("FREE");
    expect(quota.dailyLimit).toBe(60);
    expect(quota.usedToday).toBe(10);
    expect(quota.remaining).toBe(50);
    expect(quota.tokensUsedToday).toBe(500);
    expect(quota.features).toContain("tasks.autocomplete");
  });

  it("defaults to zero usage when Redis is empty", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "BUSINESS" });

    const quota = await AiService.getQuota({ userId: "user-1", workspaceId: "ws-quota-business" });

    expect(quota.plan).toBe("BUSINESS");
    expect(quota.usedToday).toBe(0);
    expect(quota.remaining).toBe(quota.dailyLimit);
  });

  it("never throws when Redis reads fail", async () => {
    const redis = createRedisMock();
    redis.get.mockRejectedValue(new Error("down"));
    mockGetRedisClient.mockReturnValue(redis);

    const quota = await AiService.getQuota({ userId: "user-1" });

    expect(quota.usedToday).toBe(0);
    expect(quota.remaining).toBeGreaterThan(0);
  });
});

describe("AiAccess.assertFeatureEnabled", () => {
  it("allows pilot features on every plan", () => {
    expect(() =>
      AiAccess.assertFeatureEnabled("FREE", "tasks.autocomplete"),
    ).not.toThrow();
    expect(() =>
      AiAccess.assertFeatureEnabled("PRO", "comments.assist"),
    ).not.toThrow();
    expect(() =>
      AiAccess.assertFeatureEnabled("BUSINESS", "goals.breakdown"),
    ).not.toThrow();
  });

  it("throws 403 when a feature is not in the plan's allowlist", () => {
    expect(() =>
      AiAccess.assertFeatureEnabled(
        "FREE",
        "insights.weekly" as "tasks.autocomplete",
      ),
    ).toThrow(ForbiddenError);
  });
});
