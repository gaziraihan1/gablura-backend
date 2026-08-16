import "dotenv/config";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import { requireCsrfToken, getCsrfTokenHandler } from "./middleware/csrf.js";
import { initSentry } from "./lib/sentry.js";

import projectRoutes from "./modules/project/project.routes.js";
import { taskRouter, initTaskRecurrenceCrons } from "./modules/task/index.js";
import {
  dailyTaskRouter,
  initDailyTaskCrons,
} from "./modules/dailyTask/index.js";
import { activityRouter } from "./modules/activity/index.js";
import userRoutes from "./routes/user.routes.js";
import uploadRoutes from "./modules/upload/upload.routes.js";
import { labelRouter } from "./modules/label/index.js";
import {
  initNotificationCrons,
  notificationRouter,
} from "./modules/notification/index.js";
import { workspaceRouter } from "./modules/workspace/index.js";
import {
  calendarRouter,
  initWellnessCrons,
  initBurnoutSignalCron,
} from "./modules/calendar/index.js";
import { focusSessionRouter } from "./modules/focusSession/index.js";
import { storageRouter } from "./modules/storage/index.js";
import { analyticsRouter } from "./modules/analytics/index.js";
import { fileManagementRouter } from "./modules/file/index.js";
import logoutRoutes from "./routes/auth.routes.js";
import internalRouter from "./routes/internal.routes.js";
import { workspaceUsageRouter } from "./modules/workspaceUsage/index.js";
import { announcementRouter } from "./modules/announcement/index.js";
import { meetingRoutes } from "./modules/meeting/index.js";
import webhookRouter from "./payment/webhook.router.js";
import { billingRouter } from "./modules/billing/index.js";
import { featureRouter } from "./modules/feature/index.js";
import { contactRouter } from "./modules/contact/index.js";
import { jobRouter } from "./modules/job/index.js";

import { authenticate } from "./middleware/auth.js";
import { sessionTimeout } from "./middleware/sessionTimeout.js";
import {
  projectAnnouncementRouter,
  workspaceAnnouncementRouter,
} from "./modules/announcement/index.js";
import { adminRouter } from "./admin/admin.routes.js";
import { checkDatabaseHealth, getPoolMetrics, disconnectAll } from "./lib/prisma.js";
import { dbMonitoring, dbPoolGuard } from "./middleware/dbMonitoring.js";
import { templatesRouter, seedOfficialTemplates } from "./modules/templates/index.js";
import { errorHandler, notFoundHandler } from "./errors/errorHandler.js";
import { adminResourceRouter, publicResourceRouter } from "./modules/resource/index.js";
import { captureException } from "./lib/sentry.js";
import apiKeyRouter from "./modules/apikey/apikey.routes.js";
import {
  automationRouter,
  initAutomationCrons,
} from "./modules/automation/index.js";
import { aiRouter } from "./modules/ai/index.js";
import { timeEntryRouter } from "./modules/timeEntry/index.js";
import { integrationRouter, workspaceIntegrationRouter, integrationWebhookRouter } from "./modules/integration/index.js";
import { initQueueWorkers, closeQueueWorkers } from "./queue/index.js";
import { applySecurity } from "./middleware/securityHeaders.js";
import { requireFocuraAdmin } from "./middleware/focuraAdmin.js";

// Initialize Sentry for error tracking
initSentry();

const app: Application = express();
// Behind a reverse proxy (e.g. Railway), Express must trust N hops so req.ip
// reflects the real client IP from X-Forwarded-For instead of the proxy's
// socket address. Default 1 (Railway appends one hop); set TRUST_PROXY_HOPS=0
// to disable or to the number of trusted proxy hops.
const trustProxyHops = parseInt(process.env.TRUST_PROXY_HOPS ?? "", 10);
app.set("trust proxy", Number.isFinite(trustProxyHops) ? trustProxyHops : 1);
const PORT = Number(process.env.PORT) || 5000;
const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  ...(!isProd ? ["http://localhost:3000", "http://localhost:3001"] : []),
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, server-to-server, curl, API tokens)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
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

app.use(webhookRouter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Security headers (helmet + explicit header policy — single source of
//    truth in src/middleware/securityHeaders.ts) ─────────────────────────────
applySecurity(app);

// ── Integration webhooks (after body parsing) ──────────────
app.use(integrationWebhookRouter);

app.use((req: Request, res: Response, next) => {
  if (process.env.NODE_ENV === "development") {
    if (!req.path.includes("/stream")) {
      console.log(`${req.method} ${req.path}`, {
        origin: req.headers.origin,
        hasAuth: !!req.headers.authorization,
        hasCsrf: !!req.headers["x-csrf-token"],
        authType: req.headers.authorization?.split(" ")[0] || "none",
      });
    }
  }
  next();
});

// Database connection pool monitoring (development only)
if (process.env.NODE_ENV === "development") {
  app.use(dbMonitoring);
}

// Database pool guard to prevent exhaustion (production only)
if (process.env.NODE_ENV === "production") {
  app.use(dbPoolGuard);
}

initNotificationCrons();
initDailyTaskCrons();
initWellnessCrons();
initBurnoutSignalCron();
initTaskRecurrenceCrons();
initAutomationCrons();

// Initialize queue workers
initQueueWorkers().catch((err) => {
  console.error("❌ Failed to initialize queue workers:", err);
});

// Seed the official template catalog (idempotent upsert by slug — safe to run
// on every boot; the catalog is a core, documented part of the product).
seedOfficialTemplates()
  .then((count) => console.log(`📦 Official template catalog ready (${count} templates)`))
  .catch((err) => console.error("❌ Failed to seed template catalog:", err));

app.get("/health", async (req: Request, res: Response) => {
  try {
    const dbHealth = await checkDatabaseHealth();

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      database: {
        primary: dbHealth.primary ? "connected" : "disconnected",
        replica: dbHealth.replica ? "connected" : "disconnected",
      },
    });
  } catch {
    res.status(503).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      database: "disconnected",
    });
  }
});

app.get("/health/db-pool", (req: Request, res: Response) => {
  if (isProd) {
    return res.status(403).json({ error: "Database pool metrics disabled in production" });
  }

  const poolMetrics = getPoolMetrics();
  res.json({
    timestamp: new Date().toISOString(),
    poolMetrics,
    configuration: {
      instanceCount: parseInt(process.env.INSTANCE_COUNT ?? "1"),
      dbMaxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? "100"),
      primaryPoolRatio: parseFloat(process.env.PRIMARY_POOL_RATIO ?? "0.3"),
      replicaPoolRatio: parseFloat(process.env.REPLICA_POOL_RATIO ?? "0.7"),
      queryTimeout: parseInt(process.env.QUERY_TIMEOUT_MS ?? "30000"),
    },
  });
});

app.get("/api/v1/debug/auth", (req: Request, res: Response) => {
  if (isProd) {
    return res
      .status(403)
      .json({ error: "Debug endpoint disabled in production" });
  }

  const authHeader = req.headers.authorization;
  const hasBearer = authHeader?.startsWith("Bearer ");

  res.json({
    environment: process.env.NODE_ENV,
    hasAuthHeader: !!authHeader,
    authType: authHeader?.split(" ")[0] || "none",
    tokenLength: hasBearer ? authHeader?.substring(7).length : 0,
    origin: req.headers.origin,
    method: req.method,
    hasCsrfToken: !!req.headers["x-csrf-token"],
    redisConfigured: !!process.env.REDIS_URL,
  });
});

// ============================================================================
// CRITICAL: CSRF Token Endpoint - NO CSRF PROTECTION
// This must come BEFORE other authenticated routes
// ============================================================================
app.get("/api/v1/csrf-token", authenticate, sessionTimeout, getCsrfTokenHandler);

// ============================================================================
// Session Activity Heartbeat
// Authenticated + sessionTimeout: every call bumps the Redis inactivity TTL.
// The frontend pings this while the user is actively interacting so an active
// user browsing cached pages is not treated as idle by the inactivity timeout.
// ============================================================================
app.get("/api/v1/auth/activity", authenticate, sessionTimeout, (_req, res) =>
  res.json({ success: true }),
);

// ============================================================================
// Public Routes (No Auth, No CSRF)
// ============================================================================
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/templates", templatesRouter);
app.use("/api/v1/auth", logoutRoutes); // Auth routes handle their own CSRF
app.use("/api/v1/internal", internalRouter); // Backend-to-backend (lockout, audit, session revocation)

// ============================================================================
// Authenticated Routes WITH CSRF Protection
// ============================================================================
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
app.use("/api/v1/workspaces", workspaceRouter); // Has its own auth middleware inside
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
app.use("/api/v1/projects", authenticate, sessionTimeout, requireCsrfToken(), projectRoutes);
app.use("/api/v1/user/integrations", authenticate, sessionTimeout, requireCsrfToken(), integrationRouter);
app.use("/api/v1/workspace-integrations", authenticate, sessionTimeout, requireCsrfToken(), workspaceIntegrationRouter);
app.use("/api/v1/tasks", authenticate, sessionTimeout, requireCsrfToken(), taskRouter);
app.use("/api/v1/automations", authenticate, sessionTimeout, requireCsrfToken(), automationRouter);
app.use("/api/v1/ai", authenticate, sessionTimeout, requireCsrfToken(), aiRouter);
app.use("/api/v1/daily-tasks", authenticate, sessionTimeout, requireCsrfToken(), dailyTaskRouter);
app.use("/api/v1/activities", authenticate, sessionTimeout, requireCsrfToken(), activityRouter);
app.use("/api/v1/user", authenticate, sessionTimeout, requireCsrfToken(), userRoutes);
app.use("/api/v1/api-keys", apiKeyRouter);
app.use("/api/v1/upload", authenticate, sessionTimeout, requireCsrfToken(), uploadRoutes);
app.use("/api/v1/labels", authenticate, sessionTimeout, requireCsrfToken(), labelRouter);
app.use("/api/v1/calendar", authenticate, sessionTimeout, requireCsrfToken(), calendarRouter);
app.use("/api/v1/time-entries", authenticate, sessionTimeout, requireCsrfToken(), timeEntryRouter);
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
app.use("/api/v1/admin", authenticate, sessionTimeout, requireCsrfToken(), requireFocuraAdmin, adminRouter);

app.use(notFoundHandler);  // catches unmatched routes → forwards to errorHandler
app.use(errorHandler); 

const server = app
  .listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(60));
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV}`);
    console.log(`🌐 Allowed Origins:`, allowedOrigins);
    console.log(`🔒 HTTPS Required: ${isProd}`);
    console.log(`🔑 Auth Method: Authorization Header (Bearer Token)`);
    console.log(
      `🛡️  CSRF Protection: ENABLED (ioredis @ ${process.env.REDIS_URL ?? "redis://localhost:6379"})`,
    );
    console.log(`📡 SSE: /api/v1/notifications/stream?token=<sseToken>`);
    console.log(
      `📅 Daily Tasks: /api/v1/daily-tasks (PRIMARY/SECONDARY prioritization)`,
    );
    console.log(`⏰ Cron Jobs: Notifications + Daily Task Cleanup`);
    console.log("=".repeat(60));
  })
  .on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use`);
    } else {
      console.error("❌ Server error:", error);
    }
    process.exit(1);
  });

const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  server.close(async () => {
    console.log("✅ HTTP server closed");

    try {
      await closeQueueWorkers();
      console.log("✅ Queue workers closed");
      await disconnectAll();
      console.log("✅ Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("⚠️  Forcing shutdown after timeout");
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  captureException(error, { type: "uncaughtException" });
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  const error = reason instanceof Error ? reason : new Error(String(reason));
  captureException(error, { 
    type: "unhandledRejection",
    promise: String(promise) 
  });
  gracefulShutdown("UNHANDLED_REJECTION");
});

export default app;
