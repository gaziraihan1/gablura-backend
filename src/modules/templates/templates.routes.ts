import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate, AuthRequest } from "../../middleware/auth.js";
import { requireFocuraAdmin } from "../../middleware/focuraAdmin.js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// init once (outside handler)
const redis = Redis.fromEnv();

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"), // 10 requests / 10 min
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
  try {
    const { email }: { email: string } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email must be a string",
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

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while sending the template",
    });
  }
});

router.use(authenticate);
router.get("/",requireFocuraAdmin, async (req, res) => {
  try {
    const templates = await prisma.templateList.findMany();
    return res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching templates",
    });
}
});

router.delete(
  '/:email',
  requireFocuraAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { email } = req.params;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Valid email is required',
        });
      }

      const decodedEmail = decodeURIComponent(email);

      await prisma.templateList.delete({
        where: {
          email: decodedEmail,
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Email deleted successfully',
      });
    } catch (error: any) {
      // Prisma: record not found
      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Email not found',
        });
      }

      console.error('Delete template email error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to delete email',
      });
    }
  }
);
export default router;