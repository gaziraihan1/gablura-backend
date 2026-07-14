import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { UserCache } from '../lib/redis/cache.client.js';

export const getUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }
    console.time("profile");


    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        timezone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        ownedWorkspaces: {
          select: {
            id: true,
            name: true,
            plan: true,
            maxStorage: true,
            slug: true
          },
        },
      },
    });
    console.timeEnd("profile");

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
};

export const updateUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    const { name, bio, image, timezone } = req.body;

    if (name !== undefined && typeof name !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid name format',
      });
      return;
    }

    if (name !== undefined && name.length > 100) {
      res.status(400).json({ success: false, message: 'Name too long (max 100 characters)' });
      return;
    }

    if (bio !== undefined && typeof bio !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid bio format',
      });
      return;
    }

    if (bio !== undefined && bio.length > 500) {
      res.status(400).json({ success: false, message: 'Bio too long (max 500 characters)' });
      return;
    }

    if (timezone !== undefined && typeof timezone !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid timezone format',
      });
      return;
    }

    if (image !== undefined && image !== null && typeof image !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid image format',
      });
      return;
    }

    if (image !== undefined && image !== null) {
      try {
        const url = new URL(image);
        if (!['http:', 'https:'].includes(url.protocol)) {
          res.status(400).json({ success: false, message: 'Image URL must use http or https protocol' });
          return;
        }
        if (image.length > 2048) {
          res.status(400).json({ success: false, message: 'Image URL too long (max 2048 characters)' });
          return;
        }
      } catch {
        res.status(400).json({ success: false, message: 'Invalid image URL format' });
        return;
      }
    }

    const updateData: Record<string, string | null> = {};
    if (name !== undefined) updateData.name = name;
    if (bio !== undefined) updateData.bio = bio;
    if (image !== undefined) updateData.image = image;
    if (timezone !== undefined) updateData.timezone = timezone;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        timezone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Invalidate user profile cache after successful update
    await UserCache.invalidateProfile(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        user: updatedUser,
      },
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
    });
  }
};