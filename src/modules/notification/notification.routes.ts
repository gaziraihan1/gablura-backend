
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

router.get("/stream", notificationStreamHandler);

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

router.use(authenticate);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.delete("/read/all", deleteAllRead);
router.delete("/:id", deleteNotification);

export default router;
