import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { requireCsrfToken, getCsrfTokenHandler } from "./middleware/csrf.js";
import { initSentry } from "./lib/sentry.js";

import projectRoutes from "./modules/project/project.routes.js";
import { taskRouter } from "./modules/task/index.js";
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
import { calendarRouter, initWellnessCrons } from "./modules/calendar/index.js";
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

// import { errorHandler } from "./middleware/errorHandler.js";
import { authenticate } from "./middleware/auth.js";
import {
  projectAnnouncementRouter,
  workspaceAnnouncementRouter,
} from "./modules/announcement/index.js";
import { adminRouter } from "./admin/admin.routes.js";
import { checkDatabaseHealth, getPoolMetrics, disconnectAll } from "./lib/prisma.js";
import { dbMonitoring, dbPoolGuard } from "./middleware/dbMonitoring.js";
import { templatesRouter } from "./modules/templates/index.js";
import { errorHandler, notFoundHandler } from "./errors/errorHandler.js";
import { adminResourceRouter, publicResourceRouter } from "./modules/resource/index.js";
import { captureException } from "./lib/sentry.js";
import { initQueueWorkers, closeQueueWorkers } from "./queue/index.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { requireFocuraAdmin } from "./middleware/focuraAdmin.js";

dotenv.config();

// Initialize Sentry for error tracking
initSentry();

const app: Application = express();
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
      // Allow requests with no origin (same-origin, server-to-server, curl)
      // ONLY in development. In production, require a valid origin header.
      if (!origin) {
        if (!isProd) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
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
            connectSrc: ["'self'", ...(allowedOrigins as string[])],
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

// Initialize queue workers
initQueueWorkers().catch((err) => {
  console.error("❌ Failed to initialize queue workers:", err);
});

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
  } catch (error) {
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
app.get("/api/v1/csrf-token", authenticate, getCsrfTokenHandler);

// ============================================================================
// Public Routes (No Auth, No CSRF)
// ============================================================================
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/templates", templatesRouter);
app.use("/api/v1/auth", logoutRoutes); // Auth routes handle their own CSRF

// ============================================================================
// Authenticated Routes WITH CSRF Protection
// ============================================================================
app.use(
  "/api/v1/workspaces/:workspaceSlug/projects/:projectId/announcements",
  authenticate,
  requireCsrfToken(),
  projectAnnouncementRouter,
);
app.use(
  "/api/v1/workspaces/:workspaceSlug/announcements",
  authenticate,
  requireCsrfToken(),
  workspaceAnnouncementRouter,
);
app.use("/api/v1/workspaces", workspaceRouter); // Has its own auth middleware inside
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
app.use("/api/v1/admin/resources", authenticate, requireCsrfToken(),adminResourceRouter ); // Admin routes for resources
app.use("/api/v1/resources", publicResourceRouter ); // Public routes for resources (if any)
app.use("/api/v1/projects", authenticate, requireCsrfToken(), projectRoutes);
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
app.use("/api/v1/admin", authenticate, requireCsrfToken(), requireFocuraAdmin, adminRouter);

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
    console.log(`📡 SSE: /api/v1/notifications/stream/:userId?token=`);
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
