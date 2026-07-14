
import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
} from "./notification.controller.js";
import { notificationStreamHandler, getDeliveryStats, getLocalConnectionCount } from "../../sockets/notification.stream.js";
import { getPublishMetrics } from "./notification.helpers.js";

const router = Router();

// ─── SSE stream: uses its own query-string token auth ────────
router.get("/stream", notificationStreamHandler);

// ─── All other endpoints require Bearer auth ─────────────────
router.use(authenticate);

// ─── Debug metrics endpoint (dev only) ──────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  router.get("/metrics", (req, res) => {
    const sseStats = getDeliveryStats();
    const publishMetrics = getPublishMetrics();
    const connectionCount = getLocalConnectionCount();

    res.json({
      success: true,
      data: {
        sse: {
          connections: connectionCount,
          delivery: sseStats,
        },
        publish: publishMetrics,
      },
    });
  });
}

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.delete("/read/all", deleteAllRead);
router.delete("/:id", deleteNotification);

export default router;
