import { Ratelimit } from "@upstash/ratelimit";
import { Router } from "express";
import { redis } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";


const router = Router();
const ratelimit = new Ratelimit({
  redis,
  limiter: {
    requests: 10,
    window: "10 m",
  } as any,
});
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

  const alreadyExists = await prisma.subscribeList.findUnique({
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