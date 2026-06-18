import { redis } from './../../lib/redis.js';
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { requireFocuraAdmin } from "../../middleware/focuraAdmin.js";
import { Ratelimit } from "@upstash/ratelimit";

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
});
const router = Router();

router.post("/", async (req, res) => {
  const identifier = req.ip ?? "anonymous";

  const { success } = await ratelimit.limit(identifier);

  if (!success) {
    return res.status(429).json({
      success: false,
      message: "Too many requests",
    });
  }

  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const alreadyExists = await prisma.templateList.findUnique({
    where: { email },
  });

  if (alreadyExists) {
    return res.status(400).json({
      success: false,
      message: "Email already exists",
    });
  }

  await prisma.templateList.create({
    data: { email },
  });

  return res.status(200).json({
    success: true,
    message: `Template sent to ${email}`,
  });
});

router.use(authenticate);

router.get("/", requireFocuraAdmin, async (_req, res) => {
  const templates = await prisma.templateList.findMany();

  return res.status(200).json({
    success: true,
    data: templates,
  });
});

router.delete("/:email", requireFocuraAdmin, async (req, res) => {
  const decodedEmail = decodeURIComponent(req.params.email);

  await prisma.templateList.delete({
    where: { email: decodedEmail },
  });

  return res.status(200).json({
    success: true,
    message: "Email deleted successfully",
  });
});

export default router;