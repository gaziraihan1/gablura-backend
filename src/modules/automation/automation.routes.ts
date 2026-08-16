/**
 * modules/automation/automation.routes.ts
 */
import { Router } from "express";
import { rateLimitUserApi } from "../../middleware/apiRateLimiter.js";
import {
  listAutomations,
  getAutomation,
  getAutomationRuns,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  testAutomation,
} from "./automation.controller.js";

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed) —
// same bucket as the other core CRUD modules.
router.use(rateLimitUserApi);

router.get("/", listAutomations);
router.post("/", createAutomation);
router.get("/:id/runs", getAutomationRuns);
router.get("/:id", getAutomation);
router.patch("/:id", updateAutomation);
router.post("/:id/test", testAutomation);
router.delete("/:id", deleteAutomation);

export default router;
