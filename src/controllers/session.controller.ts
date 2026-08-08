import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import {
  getUserActiveSessions,
  revokeUserSession,
} from "../lib/auth/sessionManager.js";
import { markSessionRevoked } from "../lib/auth/tokenRevocation.js";
import { auditLog } from "../lib/auth/auditLog.js";

// ─── User-Agent parsing helpers ───────────────────────────────────────────────

function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  const u = (ua || "").toLowerCase();

  let browser = "Unknown";
  if (/edg\//.test(u)) browser = "Edge";
  else if (/opr\/|opera/.test(u)) browser = "Opera";
  else if (/crios|chrome/.test(u)) browser = "Chrome";
  else if (/fxios|firefox/.test(u)) browser = "Firefox";
  else if (/safari/.test(u)) browser = "Safari";

  let os = "Unknown";
  if (/windows nt/.test(u)) os = "Windows";
  else if (/iphone|ipad|ipod/.test(u)) os = "iOS";
  else if (/android/.test(u)) os = "Android";
  else if (/mac os x|macintosh/.test(u)) os = "macOS";
  else if (/linux/.test(u)) os = "Linux";

  let device = "Desktop";
  if (/ipad|tablet/.test(u)) device = "Tablet";
  else if (/mobile|iphone|android.*mobile/.test(u)) device = "Mobile";

  return { device, browser, os };
}

function describeLocation(ip?: string): string {
  if (!ip || ip === "unknown" || ip === "Unknown") return "Unknown";
  if (
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  ) {
    return "Local network";
  }
  return "Unknown";
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/user/sessions — list the current user's active sessions.
 */
export const getActiveSessions = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const currentSessionId = req.user?.sessionId;
    const sessions = await getUserActiveSessions(userId);

    const data = sessions.map((s) => {
      const parsed = parseUserAgent(s.deviceInfo || "");
      return {
        id: s.sessionId,
        device: parsed.device,
        browser: parsed.browser,
        os: parsed.os,
        ip: s.ipAddress || "Unknown",
        location: describeLocation(s.ipAddress),
        lastActiveAt: s.lastActivity,
        createdAt: s.createdAt,
        isCurrent: s.sessionId === currentSessionId,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Get active sessions error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch sessions" });
  }
};

/**
 * DELETE /api/v1/user/sessions/:sessionId — revoke a single session.
 */
export const revokeSession = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    if (!userId || !sessionId) {
      res.status(400).json({ success: false, message: "Missing session id" });
      return;
    }

    const sessions = await getUserActiveSessions(userId);
    if (!sessions.some((s) => s.sessionId === sessionId)) {
      res.status(404).json({ success: false, message: "Session not found" });
      return;
    }

    await markSessionRevoked(sessionId);
    await revokeUserSession(userId, sessionId);

    auditLog("SESSION_REVOKED", {
      userId,
      sessionId,
      meta: { byUser: true, current: sessionId === req.user?.sessionId },
    });

    res.status(200).json({ success: true, message: "Session revoked" });
  } catch (error) {
    console.error("Revoke session error:", error);
    res.status(500).json({ success: false, message: "Failed to revoke session" });
  }
};

/**
 * DELETE /api/v1/user/sessions — revoke every session except the current one.
 */
export const revokeAllOtherSessions = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const currentSessionId = req.user?.sessionId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const sessions = await getUserActiveSessions(userId);
    const others = sessions.filter((s) => s.sessionId !== currentSessionId);

    for (const s of others) {
      await markSessionRevoked(s.sessionId);
      await revokeUserSession(userId, s.sessionId);
    }

    auditLog("SESSIONS_REVOKED", {
      userId,
      meta: { count: others.length },
    });

    res
      .status(200)
      .json({ success: true, message: `Revoked ${others.length} other session(s)` });
  } catch (error) {
    console.error("Revoke all sessions error:", error);
    res.status(500).json({ success: false, message: "Failed to revoke sessions" });
  }
};
