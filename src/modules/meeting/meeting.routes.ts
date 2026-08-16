import { Router } from "express";
import { rateLimitUserApi } from "../../middleware/apiRateLimiter.js";
import { MeetingController } from "./meeting.controller.js";
import { requireMeetingSlot } from "../billing/index.js";

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

router.get("/:workspaceId/meetings", MeetingController.list);
router.get("/:workspaceId/meetings/:meetingId", MeetingController.getById);
router.post("/:workspaceId/meetings", requireMeetingSlot, MeetingController.create);
router.patch("/:workspaceId/meetings/:meetingId", MeetingController.update);
router.post("/:workspaceId/meetings/:meetingId/cancel", MeetingController.cancel);
router.delete("/:workspaceId/meetings/:meetingId", MeetingController.delete);

export default router;