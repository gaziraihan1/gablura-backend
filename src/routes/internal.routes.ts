
import { Router, Request, Response, NextFunction } from "express";
import { clearFailedAttempts, recordFailedAttempt } from "../lib/auth/accountLockout.js";
import { asyncHandler } from "../errors/index.js";

const router = Router();

function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_AUTH_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

router.use(requireInternalSecret);

router.post("/failed-attempt", asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });
  await recordFailedAttempt(email);
  return res.json({ success: true });
}));

router.post("/clear-attempts", asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });
  await clearFailedAttempts(email);
  return res.json({ success: true });
}));

export default router;
