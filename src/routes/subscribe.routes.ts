import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ratelimit } from "../lib/rateLimit.js";
import { asyncHandler } from "../errors/index.js";


const router = Router();

router.post("/", asyncHandler(async (req, res) => {
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

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format",
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
}));