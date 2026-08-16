import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUserProfile, updateUserProfile, changePassword, exportUserData, deleteAccount } from '../controllers/user.controller.js';
import {
  getSecuritySettings,
  setupTwoFactor,
  verifyTwoFactor,
  disableTwoFactor,
} from '../controllers/twoFactor.controller.js';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import {
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
} from '../controllers/session.controller.js';

const router = Router();

// ─── Per-user rate limiting ────────────────────────────────────────────────────
// All profile endpoints are rate-limited (fail-closed sliding window, mirroring
// the 2FA routes). Buckets are keyed off the authenticated user id — an
// attacker who rotates IPs still hits the same bucket once the target id is
// known, and one user's traffic never consumes another user's quota.
//
// Limits (requests per window, per user):
//   Reads (profile, security, sessions, workspace-members)  60 / 60s
//   Profile updates (PUT /profile)                          20 / 60s
//   Session revocations (single)                            30 / 60s
//   Bulk session revocation                                  10 / 60s
//   Password change                                          10 / 60s
//   Account deletion                                          5 / 60s
//   Data export                                               5 / 300s
//   2FA setup / verify / disable                              10 / 60s
const rateLimitKeyByUser = (req: Request) => (req as AuthRequest).user?.id;

router.get('/profile', authenticate, rateLimitMiddleware(60, 60, rateLimitKeyByUser), getUserProfile);

router.put('/profile', authenticate, rateLimitMiddleware(20, 60, rateLimitKeyByUser), updateUserProfile);

router.put('/password', authenticate, rateLimitMiddleware(10, 60, rateLimitKeyByUser), changePassword);

// Self-service data export + account deletion
router.post('/export-data', authenticate, rateLimitMiddleware(5, 300, rateLimitKeyByUser), exportUserData);
router.delete('/account', authenticate, rateLimitMiddleware(5, 60, rateLimitKeyByUser), deleteAccount);

router.get('/security', authenticate, rateLimitMiddleware(60, 60, rateLimitKeyByUser), getSecuritySettings);

// 2FA endpoints are rate-limited (fail-closed) to throttle TOTP brute-force.
router.post('/2fa/setup', authenticate, rateLimitMiddleware(10, 60, rateLimitKeyByUser), setupTwoFactor);
router.post('/2fa/verify', authenticate, rateLimitMiddleware(10, 60, rateLimitKeyByUser), verifyTwoFactor);
router.post('/2fa/disable', authenticate, rateLimitMiddleware(10, 60, rateLimitKeyByUser), disableTwoFactor);

// Active session management (Security page)
router.get('/sessions', authenticate, rateLimitMiddleware(60, 60, rateLimitKeyByUser), getActiveSessions);
router.delete('/sessions/:sessionId', authenticate, rateLimitMiddleware(30, 60, rateLimitKeyByUser), revokeSession);
router.delete('/sessions', authenticate, rateLimitMiddleware(10, 60, rateLimitKeyByUser), revokeAllOtherSessions);

router.get('/workspace-members', authenticate, rateLimitMiddleware(60, 60, rateLimitKeyByUser), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const members = await prisma.user.findMany({
      where: {
        workspaceMembers: {
          some: {
            workspace: {
              OR: [
                { ownerId: req.user!.id },
                { members: { some: { userId: req.user!.id } } },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
      },
      distinct: ['id'],
      take: limit,
    });

    res.json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error('Get workspace members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workspace members',
    });
  }
});

export default router;