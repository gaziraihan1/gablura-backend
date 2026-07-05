import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUserProfile, updateUserProfile } from '../controllers/user.controller.js';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/profile', authenticate, getUserProfile);

router.put('/profile', authenticate, updateUserProfile);

router.get('/workspace-members', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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