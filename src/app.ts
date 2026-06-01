import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";

import { prisma } from "./lib/prisma.js";
import { authenticate } from "./middleware/auth.js";
import { getCsrfTokenHandler, requireCsrfToken } from "./middleware/csrf.js";

// routers (same as before)
import { projectRouter } from "./modules/project/index.js";
import { taskRouter } from "./modules/task/index.js";
import { dailyTaskRouter } from "./modules/dailyTask/index.js";
import { activityRouter } from "./modules/activity/index.js";
import userRoutes from "./routes/user.routes.js";
import uploadRoutes from "./modules/upload/upload.routes.js";
import { labelRouter } from "./modules/label/index.js";
import { notificationRouter } from "./modules/notification/index.js";
import { workspaceRouter } from "./modules/workspace/index.js";
import { calendarRouter } from "./modules/calendar/index.js";
import { focusSessionRouter } from "./modules/focusSession/index.js";
import { storageRouter } from "./modules/storage/index.js";
import { analyticsRouter } from "./modules/analytics/index.js";
import { fileManagementRouter } from "./modules/file/index.js";
import logoutRoutes from "./routes/auth.routes.js";
import { workspaceUsageRouter } from "./modules/workspaceUsage/index.js";
import { announcementRouter } from "./modules/announcement/index.js";
import { meetingRoutes } from "./modules/meeting/index.js";
import webhookRouter from "./payment/webhook.router.js";
import { billingRouter } from "./modules/billing/index.js";
import { featureRouter } from "./modules/feature/index.js";
import { contactRouter } from "./modules/contact/index.js";
import { jobRouter } from "./modules/job/index.js";
import { adminRouter } from "./admin/admin.routes.js";
import { templatesRouter } from "./modules/templates/index.js";
import {
  projectAnnouncementRouter,
  workspaceAnnouncementRouter,
} from "./modules/announcement/index.js";
import { errorHandler, notFoundHandler } from "./errors/errorHandler.js";

const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean) as string[];

const app: Application = express();

// ── Stripe webhook (RAW body required) ─────────────────────
app.use(webhookRouter);

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── CORS (match index.ts) ──────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-csrf-token",
      "x-show-error-toast",
      "x-show-success-toast",
    ],
  }),
);

// ── Security (match index.ts) ──────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", ...allowedOrigins],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: { action: "deny" },
  }),
);

// ── Dev debug logger (enhanced) ────────────────────────────
app.use((req: Request, _res: Response, next) => {
  if (process.env.NODE_ENV === "development") {
    if (!req.path.includes("/stream")) {
      console.log(`${req.method} ${req.path}`, {
        hasAuth: !!req.headers.authorization,
        hasCsrf: !!req.headers["x-csrf-token"],
      });
    }
  }
  next();
});

// ── Health check (enhanced like index.ts) ──────────────────
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      database: "connected",
      csrfEnabled: !!process.env.UPSTASH_REDIS_REST_URL,
    });
  } catch (error) {
    res.status(503).json({
      status: "ERROR",
      database: "disconnected",
      error: (error as Error).message,
    });
  }
});

// ── CSRF endpoint ──────────────────────────────────────────
app.get("/api/v1/csrf-token", authenticate, getCsrfTokenHandler);

// ── Public routes ──────────────────────────────────────────
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/templates", templatesRouter);
app.use("/api/v1/auth", logoutRoutes);

// ── Protected routes ───────────────────────────────────────
app.use(
  "/api/v1/workspaces/:workspaceId/projects/:projectId/announcements",
  authenticate,
  requireCsrfToken(),
  projectAnnouncementRouter,
);
app.use(
  "/api/v1/workspaces/:workspaceId/announcements",
  authenticate,
  requireCsrfToken(),
  workspaceAnnouncementRouter,
);
app.use("/api/v1/workspaces", workspaceRouter);
app.use(
  "/api/v1/workspaces/:workspaceId/billing",
  authenticate,
  requireCsrfToken(),
  billingRouter,
);
app.use(
  "/api/v1/announcements",
  authenticate,
  requireCsrfToken(),
  announcementRouter,
);
app.use("/api/v1/projects", authenticate, requireCsrfToken(), projectRouter);
app.use("/api/v1/tasks", authenticate, requireCsrfToken(), taskRouter);
app.use("/api/v1/daily-tasks", authenticate, requireCsrfToken(), dailyTaskRouter);
app.use("/api/v1/activities", authenticate, requireCsrfToken(), activityRouter);
app.use("/api/v1/user", authenticate, requireCsrfToken(), userRoutes);
app.use("/api/v1/upload", authenticate, requireCsrfToken(), uploadRoutes);
app.use("/api/v1/labels", authenticate, requireCsrfToken(), labelRouter);
app.use("/api/v1/calendar", authenticate, requireCsrfToken(), calendarRouter);
app.use(
  "/api/v1/focus-sessions",
  authenticate,
  requireCsrfToken(),
  focusSessionRouter,
);
app.use("/api/v1/storage", authenticate, requireCsrfToken(), storageRouter);
app.use("/api/v1/analytics", authenticate, requireCsrfToken(), analyticsRouter);
app.use(
  "/api/v1/file-management",
  authenticate,
  requireCsrfToken(),
  fileManagementRouter,
);
app.use(
  "/api/v1/workspace-usage",
  authenticate,
  requireCsrfToken(),
  workspaceUsageRouter,
);
app.use("/api/v1/meetings", authenticate, requireCsrfToken(), meetingRoutes);
app.use("/api/v1/features", authenticate, requireCsrfToken(), featureRouter);
app.use("/api/v1/admin", authenticate, requireCsrfToken(), adminRouter);

// ── 404 ───────────────────────────────────────────────────
app.use(notFoundHandler);  // catches unmatched routes → forwards to errorHandler
app.use(errorHandler); 

// ── Global error handler ───────────────────────────────────
app.use(errorHandler);

export default app;
