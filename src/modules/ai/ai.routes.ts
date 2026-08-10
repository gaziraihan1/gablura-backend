import { Router } from "express";
import {
  autocomplete,
  breakdown,
  commentAssist,
  getQuota,
  getUsage,
  planDaily,
  summarizeMeeting,
  weeklyInsights,
} from "./ai.controller.js";
import { aiRateLimit } from "./ai.ratelimit.js";

const router = Router();

// Quota + usage reports are reads — they must never consume the AI budget.
router.get("/quota", getQuota);
router.get("/usage", getUsage);

// Generation routes all go through the tier-based limiter.
router.post("/tasks/autocomplete", aiRateLimit, autocomplete);
router.post("/goals/breakdown", aiRateLimit, breakdown);
router.post("/comments/assist", aiRateLimit, commentAssist);
router.post("/plan/daily", aiRateLimit, planDaily);
router.post("/meetings/summarize", aiRateLimit, summarizeMeeting);
router.post("/insights/weekly", aiRateLimit, weeklyInsights);

export default router;
