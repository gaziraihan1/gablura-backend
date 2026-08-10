import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";

import { prisma } from "./lib/prisma.js";
import { authenticate } from "./middleware/auth.js";
import { sessionTimeout } from "./middleware/sessionTimeout.js";
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
import { adminResourceRouter, publicResourceRouter } from "./modules/resource/index.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { requireFocuraAdmin } from "./middleware/focuraAdmin.js";
import apiKeyRouter from "./modules/apikey/apikey.routes.js";
import { integrationRouter, workspaceIntegrationRouter, integrationWebhookRouter } from "./modules/integration/index.js";
import { aiRouter } from "./modules/ai/index.js";

const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  ...(!isProd ? ["http://localhost:3000", "http://localhost:3001"] : []),
].filter(Boolean) as string[];

const app: Application = express();

// ── Stripe webhook (RAW body required) ─────────────────────
app.use(webhookRouter);

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Body Parser Error Handler ───────────────────────────────
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Payload too large',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Malformed JSON payload',
      code: 'MALFORMED_JSON',
    });
  }
  next(err);
});

// ── Integration webhooks (after body parsing) ───────────────
app.use(integrationWebhookRouter);

// ── CORS (match index.ts) ──────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, server-to-server, curl, API tokens)
      if (!origin) {
        return callback(null, true);
      }
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
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'", ...allowedOrigins],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            mediaSrc: ["'self'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: { action: "deny" },
  }),
);

// ── Additional security headers ───────────────────────────
app.use(securityHeaders);

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
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "ERROR",
      database: "disconnected",
    });
  }
});

// ── CSRF endpoint ──────────────────────────────────────────
app.get("/api/v1/csrf-token", authenticate, sessionTimeout, getCsrfTokenHandler);

// ── Public routes ──────────────────────────────────────────
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/templates", templatesRouter);
app.use("/api/v1/auth", logoutRoutes);

// ── Protected routes ───────────────────────────────────────
app.use(
  "/api/v1/workspaces/:workspaceSlug/projects/:projectId/announcements",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  projectAnnouncementRouter,
);
app.use(
  "/api/v1/workspaces/:workspaceSlug/announcements",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  workspaceAnnouncementRouter,
);
app.use("/api/v1/workspaces", workspaceRouter);
app.use(
  "/api/v1/workspaces/:workspaceId/billing",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  billingRouter,
);
app.use(
  "/api/v1/announcements",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  announcementRouter,
);
app.use("/api/v1/admin/resources", authenticate, sessionTimeout, requireCsrfToken(),adminResourceRouter ); // Admin routes for resources
app.use("/api/v1/resources", publicResourceRouter ); // Public routes for resources (if any)
app.use("/api/v1/projects", authenticate, sessionTimeout, requireCsrfToken(), projectRouter);
app.use("/api/v1/user/integrations", authenticate, sessionTimeout, requireCsrfToken(), integrationRouter);
app.use("/api/v1/workspace-integrations", authenticate, sessionTimeout, requireCsrfToken(), workspaceIntegrationRouter);
app.use("/api/v1/tasks", authenticate, sessionTimeout, requireCsrfToken(), taskRouter);
app.use("/api/v1/daily-tasks", authenticate, sessionTimeout, requireCsrfToken(), dailyTaskRouter);
app.use("/api/v1/activities", authenticate, sessionTimeout, requireCsrfToken(), activityRouter);
app.use("/api/v1/user", authenticate, sessionTimeout, requireCsrfToken(), userRoutes);
app.use("/api/v1/api-keys", apiKeyRouter);
app.use("/api/v1/upload", authenticate, sessionTimeout, requireCsrfToken(), uploadRoutes);
app.use("/api/v1/labels", authenticate, sessionTimeout, requireCsrfToken(), labelRouter);
app.use("/api/v1/calendar", authenticate, sessionTimeout, requireCsrfToken(), calendarRouter);
app.use(
  "/api/v1/focus-sessions",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  focusSessionRouter,
);
app.use("/api/v1/storage", authenticate, sessionTimeout, requireCsrfToken(), storageRouter);
app.use("/api/v1/analytics", authenticate, sessionTimeout, requireCsrfToken(), analyticsRouter);
app.use(
  "/api/v1/file-management",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  fileManagementRouter,
);
app.use(
  "/api/v1/workspace-usage",
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  workspaceUsageRouter,
);
app.use("/api/v1/meetings", authenticate, sessionTimeout, requireCsrfToken(), meetingRoutes);
app.use("/api/v1/features", authenticate, sessionTimeout, requireCsrfToken(), featureRouter);
app.use("/api/v1/ai", authenticate, sessionTimeout, requireCsrfToken(), aiRouter);
app.use("/api/v1/admin", authenticate, sessionTimeout, requireCsrfToken(), requireFocuraAdmin, adminRouter);

// ── 404 ───────────────────────────────────────────────────
app.use(notFoundHandler);  // catches unmatched routes → forwards to errorHandler
app.use(errorHandler); 


export default app;
