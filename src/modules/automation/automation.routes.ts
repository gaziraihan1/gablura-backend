/**
 * modules/automation/automation.routes.ts
 */
import { Router } from "express";
import {
  listAutomations,
  getAutomation,
  getAutomationRuns,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from "./automation.controller.js";

const router = Router();

router.get("/", listAutomations);
router.post("/", createAutomation);
router.get("/:id/runs", getAutomationRuns);
router.get("/:id", getAutomation);
router.patch("/:id", updateAutomation);
router.delete("/:id", deleteAutomation);

export default router;
