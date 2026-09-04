/**
 * AI module — types & plan configuration.
 *
 * The authoritative cost-guard table: every AI call is billed against the
 * workspace's plan (or, for personal flows, the user's highest plan). Limits
 * are intentionally conservative — AI calls cost real money per token.
 */

export const AI_PLAN_LIMITS = {
  FREE: {
    burstPerMinute: 3, // hard spike protection
    hourly: 15, // sustained use per hour
    daily: 60, // per calendar day
    dailyTokens: 40_000, // ~1,000 small calls
    monthlyTokens: 500_000, // ≈ $0.30–0.60 / month
    model: "lite",
    maxOutputTokens: 512,
    features: ["tasks.autocomplete", "goals.breakdown", "comments.assist"],
  },
  PRO: {
    burstPerMinute: 10,
    hourly: 60,
    daily: 300,
    dailyTokens: 300_000,
    monthlyTokens: 4_000_000, // ≈ $3–6 / month
    model: "std",
    maxOutputTokens: 1024,
    features: [
      "tasks.autocomplete",
      "goals.breakdown",
      "comments.assist",
      "plan.daily",
      "meetings.summarize",
    ],
  },
  BUSINESS: {
    burstPerMinute: 30,
    hourly: 200,
    daily: 2_000,
    dailyTokens: 2_000_000,
    monthlyTokens: 25_000_000, // ≈ $25–45 / month
    model: "std",
    maxOutputTokens: 2048,
    features: ["*"], // everything
  },
  ENTERPRISE: {
    // Mirrors BUSINESS — the top-tier AI allowance until a dedicated
    // ENTERPRISE tier is defined. Without this entry ENTERPRISE workspaces
    // silently fell back to FREE limits (3 calls/min, no plan.daily etc.).
    burstPerMinute: 30,
    hourly: 200,
    daily: 2_000,
    dailyTokens: 2_000_000,
    monthlyTokens: 25_000_000,
    model: "std",
    maxOutputTokens: 2048,
    features: ["*"], // everything incl. insights.weekly
  },
} as const;

export type AiPlan = keyof typeof AI_PLAN_LIMITS;

/**
 * The effective per-plan AI limits. Workspaces may override `daily`,
 * `monthlyTokens` and `maxOutputTokens` via the Gablura admin dashboard
 * (Workspace.aiDailyCalls / aiMonthlyTokens / aiMaxOutputTokens); the other
 * fields always come from `AI_PLAN_LIMITS`.
 */
export interface AiLimits {
  burstPerMinute: number;
  hourly: number;
  daily: number;
  dailyTokens: number;
  monthlyTokens: number;
  model: "lite" | "std" | "pro";
  maxOutputTokens: number;
  features: readonly string[];
}

export type AiFeature =
  | "tasks.autocomplete"
  | "goals.breakdown"
  | "comments.assist"
  | "plan.daily"
  | "meetings.summarize"
  | "insights.weekly";

export type AiEnergyType = "LOW" | "MEDIUM" | "HIGH";
export type AiPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type AiIntent =
  | "EXECUTION"
  | "PLANNING"
  | "REVIEW"
  | "LEARNING"
  | "COMMUNICATION";
export type AiCommentTone =
  | "professional"
  | "friendly"
  | "concise"
  | "formal"
  | "persuasive";

// ─── Feature contracts (validated server-side with Zod in ai.validators.ts) ──

export interface AutocompleteInput {
  workspaceId?: string;
  title: string;
  projectId?: string;
  energyType?: AiEnergyType;
}

export interface AutocompleteOutput {
  description: string;
  priority?: AiPriority | null;
  estimatedHours?: number | null;
  dueDate?: string | null;
  energyType?: AiEnergyType | null;
  intent?: AiIntent | null;
  subtasks?: { title: string }[];
}

export interface BreakdownInput {
  workspaceId?: string;
  goal: string;
  energyType?: AiEnergyType;
}

export interface BreakdownOutput {
  tasks: { title: string; energyType?: AiEnergyType | null; estimatedHours?: number | null }[];
  rationale?: string;
}

export interface CommentAssistInput {
  workspaceId?: string;
  text: string;
  tone: AiCommentTone;
}

export interface CommentAssistOutput {
  text: string;
}

// ─── Phase 2: plan.daily (auto-scheduler) ────────────────────────────────────

/** A single candidate task the scheduler may order for the day. */
export interface DailyPlanTaskInput {
  id: string;
  title: string;
  priority?: AiPriority | null;
  energyType?: AiEnergyType | null;
  estimatedHours?: number | null;
  dueDate?: string | null;
}

export interface DailyPlanInput {
  workspaceId?: string;
  date: string;
  tasks: DailyPlanTaskInput[];
}

/** One ordered slot in the AI-suggested day plan. */
export interface DailyPlanEntry {
  taskId: string;
  order: number;
  reason: string;
}

export interface DailyPlanOutput {
  plan: DailyPlanEntry[];
  rationale?: string;
}

// ─── Phase 2: meetings.summarize ─────────────────────────────────────────────

export interface MeetingSummaryInput {
  workspaceId?: string;
  meetingId: string;
  /** Free-form meeting notes the user pasted (optional — falls back to the meeting record). */
  notes?: string;
}

export interface MeetingActionItem {
  text: string;
  assigneeEmail?: string | null;
}

export interface MeetingSummaryOutput {
  summary: string;
  actionItems: MeetingActionItem[];
}

// ─── Phase 3: insights.weekly (BUSINESS-only) ─────────────────────────────────

export interface WeeklyInsightsInput {
  /** Required — insights are workspace-scoped (BUSINESS plan). */
  workspaceId: string;
  /** Optional week start (YYYY-MM-DD). Defaults to the current week (Monday). */
  week?: string;
}

export interface WeeklyInsightHighlight {
  title: string;
  detail?: string;
}

export interface WeeklyInsightRisk {
  title: string;
  detail?: string;
  severity: "low" | "medium" | "high";
}

export interface WeeklyInsightsOutput {
  summary: string;
  highlights: WeeklyInsightHighlight[];
  risks: WeeklyInsightRisk[];
}

export interface AiQuotaResponse {
  plan: AiPlan;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  burstPerMinute: number;
  hourly: number;
  dailyTokens: number;
  monthlyTokens: number;
  /** Effective per-response output cap (honors Gablura-admin overrides). */
  maxOutputTokens: number;
  tokensUsedToday: number;
  tokensUsedThisMonth: number;
  features: readonly string[];
  /** ISO timestamp of the next daily reset (local midnight). */
  resetAt: string;
  /** Plan defaults for the overrideable fields — what the tier gives without admin changes. */
  defaults: Pick<AiLimits, "daily" | "monthlyTokens" | "maxOutputTokens">;
  /** Per-workspace Gablura-admin overrides currently active (absent field = plan default). */
  overrides: Partial<Pick<AiLimits, "daily" | "monthlyTokens" | "maxOutputTokens">>;
}

// ─── Phase 4: AiUsageLog usage report (OWNER/ADMIN only) ──────────────────────

export interface AiUsageQuery {
  workspaceId: string;
  /** Look-back window in days (1–90). Defaults to 30. */
  days?: number;
}

export interface AiUsageByFeature {
  feature: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
}

export interface AiUsageByModel {
  model: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
}

export interface AiUsageRecentRow {
  id: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  createdAt: string;
}

export interface AiUsageReport {
  workspaceId: string;
  days: number;
  period: { start: string; end: string };
  total: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  byFeature: AiUsageByFeature[];
  byModel: AiUsageByModel[];
  recent: AiUsageRecentRow[];
}
