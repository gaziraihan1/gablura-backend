/**
 * src/modules/notification/notification.controller.ts
 *
 * Changes from your original
 * ───────────────────────────
 * getUnreadCount: NotificationQuery.getUnreadCount now returns { count }
 * directly (not a raw number), so res.json wraps it correctly as:
 *   { success: true, data: { count: N } }
 * which matches what the frontend reads as response.data.data.count.
 *
 * Everything else is identical to your existing controller.
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { createSseToken, extractJti } from "../../lib/auth/backendToken.js";
import { storeSseToken } from "../../lib/auth/tokenRevocation.js";
import { NotificationQuery } from "./notification.query.js";
import { NotificationMutation } from "./notification.mutation.js";

function requireUserId(req: AuthRequest, res: Response): string | null {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

/**
 * Mint a fresh 30-second, single-use SSE token on demand. The notification
 * stream accepts only these tokens, and each one opens exactly one connection
 * — so the frontend calls this endpoint before every (re)connect instead of
 * reusing a session token (which would 401 TOKEN_REUSED on the second try).
 */
export const getSseToken = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const sseToken = createSseToken(userId);
    await storeSseToken(extractJti(sseToken), userId);
    res.json({ success: true, sseToken });
  } catch (error: any) {
    console.error("Get SSE token error:", error);
    // Distinguish Redis failures (503) from unexpected errors (500)
    const isRedisError = error?.name === 'ReplyError' || 
                        error?.name === 'MaxRetriesPerRequestError' ||
                        error?.code === 'ECONNREFUSED' || 
                        error?.message?.includes('max requests') ||
                        error?.message?.includes('max retries');
    res.status(isRedisError ? 503 : 500).json({
      success: false,
      message: isRedisError ? 'Service temporarily unavailable. Please try again.' : 'Failed to issue SSE token',
    });
  }
};

export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const cursor = req.query.cursor as string | undefined;

    // Returns { items, nextCursor, hasMore }
    const notifications = await NotificationQuery.getUserNotification(
      userId,
      cursor,
    );
    res.json({ success: true, data: notifications });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    // Returns { count: number }
    const data = await NotificationQuery.getUnreadCount(userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch unread count" });
  }
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const notification = await NotificationMutation.markAsRead(req.params.id, userId);
    res.json({ success: true, data: notification });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
};

export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const result = await NotificationMutation.markAllAsRead(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Mark all as read error:", error);
    res.status(500).json({ success: false, message: "Failed to mark all as read" });
  }
};

export const deleteNotification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    await NotificationMutation.deleteNotification(req.params.id, userId);
    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

export const deleteAllRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const result = await NotificationMutation.deleteAllReadNotifications(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Delete all read error:", error);
    res.status(500).json({ success: false, message: "Failed to delete notifications" });
  }
};