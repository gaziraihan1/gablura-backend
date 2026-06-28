import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { requireFocuraAdmin } from "../../middleware/focuraAdmin.js";
import { rateLimitMiddleware } from "../../middleware/rateLimiter.js";


const router = Router();

router.post("/", rateLimitMiddleware(5, 600), async (req, res) => {
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