import { Router, Response } from 'express';
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

router.get('/profile', authenticate, getUserProfile);

router.put('/profile', authenticate, updateUserProfile);

router.put('/password', authenticate, changePassword);

// Self-service data export + account deletion
router.post('/export-data', authenticate, exportUserData);
router.delete('/account', authenticate, deleteAccount);

router.get('/security', authenticate, getSecuritySettings);

// 2FA endpoints are rate-limited (fail-closed) to throttle TOTP brute-force.
router.post('/2fa/setup', authenticate, rateLimitMiddleware(10, 60, (req) => (req as AuthRequest).user?.id), setupTwoFactor);
router.post('/2fa/verify', authenticate, rateLimitMiddleware(10, 60, (req) => (req as AuthRequest).user?.id), verifyTwoFactor);
router.post('/2fa/disable', authenticate, rateLimitMiddleware(10, 60, (req) => (req as AuthRequest).user?.id), disableTwoFactor);

// Active session management (Security page)
router.get('/sessions', authenticate, getActiveSessions);
router.delete('/sessions/:sessionId', authenticate, revokeSession);
router.delete('/sessions', authenticate, revokeAllOtherSessions);

router.get('/workspace-members', authenticate, async (req: AuthRequest, res: Response) => {
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