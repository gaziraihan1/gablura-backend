import { describe, it, expect } from "vitest";
import {
  autocompleteInputSchema,
  autocompleteOutputSchema,
  breakdownInputSchema,
  breakdownOutputSchema,
  commentAssistInputSchema,
  commentAssistOutputSchema,
  dailyPlanInputSchema,
  dailyPlanOutputSchema,
  meetingSummaryInputSchema,
  meetingSummaryOutputSchema,
  quotaQuerySchema,
  usageQuerySchema,
  weeklyInsightsInputSchema,
  weeklyInsightsOutputSchema,
} from "../../../modules/ai/ai.validators.js";

describe("ai.validators — input schemas", () => {
  describe("autocompleteInputSchema", () => {
    it("accepts a minimal valid payload", () => {
      const parsed = autocompleteInputSchema.safeParse({ title: "Fix login bug" });
      expect(parsed.success).toBe(true);
    });

    it("accepts an optional workspaceId + energyType", () => {
      const parsed = autocompleteInputSchema.safeParse({
        workspaceId: "ws-1",
        title: "Write tests",
        energyType: "HIGH",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.workspaceId).toBe("ws-1");
        expect(parsed.data.energyType).toBe("HIGH");
      }
    });

    it("rejects a title shorter than 3 characters", () => {
      const parsed = autocompleteInputSchema.safeParse({ title: "ab" });
      expect(parsed.success).toBe(false);
    });

    it("rejects a title longer than 200 characters", () => {
      const parsed = autocompleteInputSchema.safeParse({ title: "x".repeat(201) });
      expect(parsed.success).toBe(false);
    });

    it("rejects an invalid energyType", () => {
      const parsed = autocompleteInputSchema.safeParse({
        title: "Fix bug",
        energyType: "EXTREME",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("breakdownInputSchema", () => {
    it("accepts a valid goal", () => {
      const parsed = breakdownInputSchema.safeParse({ goal: "Launch the mobile app" });
      expect(parsed.success).toBe(true);
    });

    it("rejects a goal shorter than 5 characters", () => {
      const parsed = breakdownInputSchema.safeParse({ goal: "Ship" });
      expect(parsed.success).toBe(false);
    });
  });

  describe("commentAssistInputSchema", () => {
    it("defaults tone to professional", () => {
      const parsed = commentAssistInputSchema.safeParse({ text: "Great work!" });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.tone).toBe("professional");
    });

    it("accepts an explicit tone", () => {
      const parsed = commentAssistInputSchema.safeParse({
        text: "Great work!",
        tone: "friendly",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an unknown tone", () => {
      const parsed = commentAssistInputSchema.safeParse({
        text: "Great work!",
        tone: "aggressive",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects text shorter than 2 characters", () => {
      const parsed = commentAssistInputSchema.safeParse({ text: "a" });
      expect(parsed.success).toBe(false);
    });
  });

  describe("usageQuerySchema", () => {
    it("accepts a workspaceId without days", () => {
      const parsed = usageQuerySchema.safeParse({ workspaceId: "ws-1" });
      expect(parsed.success).toBe(true);
    });

    it("coerces a string days value", () => {
      const parsed = usageQuerySchema.safeParse({ workspaceId: "ws-1", days: "30" });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.days).toBe(30);
    });

    it("requires a workspaceId", () => {
      const parsed = usageQuerySchema.safeParse({});
      expect(parsed.success).toBe(false);
    });

    it("rejects days outside 1–90", () => {
      expect(usageQuerySchema.safeParse({ workspaceId: "ws-1", days: 0 }).success).toBe(false);
      expect(usageQuerySchema.safeParse({ workspaceId: "ws-1", days: 91 }).success).toBe(false);
    });
  });

  describe("quotaQuerySchema", () => {
    it("accepts no workspaceId (personal scope)", () => {
      const parsed = quotaQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.workspaceId).toBeUndefined();
      }
    });

    it("accepts a workspaceId", () => {
      const parsed = quotaQuerySchema.safeParse({ workspaceId: "ws-1" });
      expect(parsed.success).toBe(true);
    });
  });

  describe("dailyPlanInputSchema", () => {
    it("accepts a valid day-plan payload", () => {
      const parsed = dailyPlanInputSchema.safeParse({
        date: "2026-08-10",
        tasks: [
          { id: "t1", title: "Fix login bug", priority: "URGENT", energyType: "HIGH", estimatedHours: 2 },
          { id: "t2", title: "Reply to emails", priority: "LOW", energyType: "LOW" },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an invalid date format", () => {
      const parsed = dailyPlanInputSchema.safeParse({
        date: "10/08/2026",
        tasks: [{ id: "t1", title: "Do the thing" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects an empty task list", () => {
      const parsed = dailyPlanInputSchema.safeParse({ date: "2026-08-10", tasks: [] });
      expect(parsed.success).toBe(false);
    });

    it("rejects more than 50 tasks", () => {
      const tasks = Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` }));
      const parsed = dailyPlanInputSchema.safeParse({ date: "2026-08-10", tasks });
      expect(parsed.success).toBe(false);
    });
  });

  describe("meetingSummaryInputSchema", () => {
    it("accepts a meetingId with optional notes", () => {
      const parsed = meetingSummaryInputSchema.safeParse({
        meetingId: "m1",
        notes: "Discussed Q3 roadmap.",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.notes).toBe("Discussed Q3 roadmap.");
    });

    it("accepts meetingId alone (falls back to the meeting record)", () => {
      const parsed = meetingSummaryInputSchema.safeParse({ meetingId: "m1" });
      expect(parsed.success).toBe(true);
    });

    it("rejects a missing meetingId", () => {
      const parsed = meetingSummaryInputSchema.safeParse({ notes: "x" });
      expect(parsed.success).toBe(false);
    });
  });

  describe("weeklyInsightsInputSchema", () => {
    it("requires a workspaceId", () => {
      const parsed = weeklyInsightsInputSchema.safeParse({});
      expect(parsed.success).toBe(false);
    });

    it("accepts a workspaceId with an optional week", () => {
      const parsed = weeklyInsightsInputSchema.safeParse({
        workspaceId: "ws-1",
        week: "2026-08-03",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an invalid week format", () => {
      const parsed = weeklyInsightsInputSchema.safeParse({
        workspaceId: "ws-1",
        week: "03/08/2026",
      });
      expect(parsed.success).toBe(false);
    });
  });
});

describe("ai.validators — LLM output schemas", () => {
  describe("autocompleteOutputSchema", () => {
    it("accepts a fully populated suggestion", () => {
      const parsed = autocompleteOutputSchema.safeParse({
        description: "Investigate and fix the login redirect bug on mobile.",
        priority: "HIGH",
        estimatedHours: 2,
        dueDate: "2026-08-15",
        energyType: "MEDIUM",
        intent: "EXECUTION",
        subtasks: [{ title: "Reproduce locally" }, { title: "Deploy fix" }],
      });
      expect(parsed.success).toBe(true);
    });

    it("strips unknown keys instead of failing", () => {
      const result = autocompleteOutputSchema.parse({
        description: "Do the thing",
        hallucinatedKey: true,
      });
      expect(result).not.toHaveProperty("hallucinatedKey");
    });

    it("rejects an invalid priority", () => {
      const parsed = autocompleteOutputSchema.safeParse({
        description: "Do the thing",
        priority: "URGENTEST",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects missing description", () => {
      const parsed = autocompleteOutputSchema.safeParse({ priority: "HIGH" });
      expect(parsed.success).toBe(false);
    });

    it("rejects more than 20 subtasks", () => {
      const parsed = autocompleteOutputSchema.safeParse({
        description: "Do the thing",
        subtasks: Array.from({ length: 21 }, (_, i) => ({ title: `Sub ${i}` })),
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("breakdownOutputSchema", () => {
    it("accepts a valid task list", () => {
      const parsed = breakdownOutputSchema.safeParse({
        tasks: [
          { title: "Outline the plan", energyType: "LOW", estimatedHours: 1 },
          { title: "Build the core", energyType: "HIGH", estimatedHours: 4 },
        ],
        rationale: "Start small to build momentum.",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an empty task list", () => {
      const parsed = breakdownOutputSchema.safeParse({ tasks: [] });
      expect(parsed.success).toBe(false);
    });

    it("rejects a task without a title", () => {
      const parsed = breakdownOutputSchema.safeParse({
        tasks: [{ energyType: "LOW" }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("commentAssistOutputSchema", () => {
    it("accepts rewritten text", () => {
      const parsed = commentAssistOutputSchema.safeParse({
        text: "Could you please review the PR?",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects empty text", () => {
      const parsed = commentAssistOutputSchema.safeParse({ text: "   " });
      expect(parsed.success).toBe(false);
    });
  });

  describe("dailyPlanOutputSchema", () => {
    it("accepts an ordered plan", () => {
      const parsed = dailyPlanOutputSchema.safeParse({
        plan: [
          { taskId: "t1", order: 1, reason: "Urgent and due today" },
          { taskId: "t2", order: 2, reason: "Low energy filler" },
        ],
        rationale: "Front-load the urgent work.",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an entry with an unknown task id field name", () => {
      const parsed = dailyPlanOutputSchema.safeParse({
        plan: [{ id: "t1", order: 1, reason: "x" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects a non-integer order", () => {
      const parsed = dailyPlanOutputSchema.safeParse({
        plan: [{ taskId: "t1", order: 1.5, reason: "x" }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("meetingSummaryOutputSchema", () => {
    it("accepts summary + action items", () => {
      const parsed = meetingSummaryOutputSchema.safeParse({
        summary: "Team agreed on the Q3 roadmap.",
        actionItems: [
          { text: "Draft the budget", assigneeEmail: "finance@example.com" },
          { text: "Follow up with design" },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts summary without action items", () => {
      const parsed = meetingSummaryOutputSchema.safeParse({
        summary: "Short check-in.",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an invalid assignee email", () => {
      const parsed = meetingSummaryOutputSchema.safeParse({
        summary: "x",
        actionItems: [{ text: "Do it", assigneeEmail: "not-an-email" }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("weeklyInsightsOutputSchema", () => {
    it("accepts a full insights payload", () => {
      const parsed = weeklyInsightsOutputSchema.safeParse({
        summary: "A strong week with steady completion.",
        highlights: [{ title: "12 tasks completed", detail: "up from 8" }],
        risks: [{ title: "Overdue workload rising", severity: "high" }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.risks![0].severity).toBe("high");
    });

    it("defaults severity to medium", () => {
      const parsed = weeklyInsightsOutputSchema.safeParse({
        summary: "x",
        risks: [{ title: "Watch the backlog" }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.risks![0].severity).toBe("medium");
    });

    it("rejects an unknown severity", () => {
      const parsed = weeklyInsightsOutputSchema.safeParse({
        summary: "x",
        risks: [{ title: "y", severity: "critical" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("requires a summary", () => {
      const parsed = weeklyInsightsOutputSchema.safeParse({ highlights: [] });
      expect(parsed.success).toBe(false);
    });
  });
});
