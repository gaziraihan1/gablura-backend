import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { UserCache, WorkspaceCache } from '../lib/redis/cache.client.js';
import argon2 from 'argon2';
import { buildUserExportBundle } from '../lib/dataExport.js';
import { addSendEmailJob } from '../queue/index.js';
import { auditLog } from '../lib/auth/auditLog.js';
import { revokeAllRefreshTokens, markSessionRevoked } from '../lib/auth/tokenRevocation.js';
import { getUserActiveSessions, revokeUserSession } from '../lib/auth/sessionManager.js';

export const getUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

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

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
      return;
    }

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Invalid password format',
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters',
      });
      return;
    }

    if (newPassword.length > 128) {
      res.status(400).json({
        success: false,
        message: 'New password must be less than 128 characters',
      });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({
        success: false,
        message: 'New password must be different from current password',
      });
      return;
    }

    // Fetch user with password hash
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, password: true },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // Check if user has a password (OAuth-only accounts may not)
    if (!user.password) {
      res.status(400).json({
        success: false,
        message: 'This account uses social login. Please set a password through the account settings.',
      });
      return;
    }

    // Verify current password
    const isValidPassword = await argon2.verify(user.password, currentPassword);
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
      return;
    }

    // Hash new password
    const hashedPassword = await argon2.hash(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword, lastPasswordChange: new Date() },
    });

    // Invalidate user cache
    await UserCache.invalidateProfile(req.user.id);

    // Session lifecycle: the password just changed, so every OTHER session
    // must die immediately — a stolen session on another device must not
    // outlive the credential rotation. The current session keeps working
    // (the user just proved knowledge of the old password). Best-effort: the
    // Redis helpers swallow their own errors so a Redis blip never turns a
    // successful password change into a 500.
    try {
      const sessions = await getUserActiveSessions(req.user.id);
      const others = sessions.filter((s) => s.sessionId !== req.user?.sessionId);
      for (const session of others) {
        await markSessionRevoked(session.sessionId);
        await revokeUserSession(req.user.id, session.sessionId);
      }
      auditLog('SESSIONS_REVOKED', {
        userId: req.user.id,
        sessionId: req.user.sessionId,
        meta: { reason: 'password_changed', count: others.length },
      });
    } catch (err) {
      console.error('❌ Failed to revoke other sessions after password change:', err);
    }

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
    });
  }
};
export const exportUserData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const bundle = await buildUserExportBundle(req.user.id);

    if (!bundle.profile) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const json = JSON.stringify(bundle, null, 2);
    const fileName = `gablura-export-${bundle.profile.id}-${new Date().toISOString().slice(0, 10)}.json`;

    if (json.length > 4 * 1024 * 1024) {
      console.warn(`[DataExport] Large export (${json.length} bytes) for user ${req.user.id}`);
    }

    await addSendEmailJob({
      type: 'data-export-email',
      to: bundle.profile.email,
      subject: 'Your Gablura data export is ready',
      data: {
        toEmail: bundle.profile.email,
        toName: bundle.profile.name,
        fileName,
        json,
      },
    });

    auditLog('DATA_EXPORT', {
      userId: bundle.profile.id,
      email: bundle.profile.email,
      reason: 'Self-service data export',
      meta: {
        fileName,
        recordCount: {
          projects: bundle.projects.length,
          tasks: bundle.tasks.length,
          comments: bundle.comments.length,
          focusSessions: bundle.focusSessions.length,
          timeEntries: bundle.timeEntries.length,
        },
      },
    });

    res.status(202).json({
      success: true,
      message: 'Data export requested - the JSON bundle will be emailed to you shortly.',
    });
  } catch (error) {
    console.error('❌ Data export error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate data export' });
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const userId = req.user.id;
    const email = req.user.email;

    // Re-authentication: irreversible action — require the account password
    // when one is set (OAuth-only accounts have no password and are already
    // authenticated via the access token).
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!account) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (account.password) {
      const { password } = req.body ?? {};
      if (typeof password !== 'string' || password.length === 0) {
        res.status(400).json({ success: false, message: 'Password is required to delete your account.' });
        return;
      }
      const isValidPassword = await argon2.verify(account.password, password);
      if (!isValidPassword) {
        res.status(401).json({ success: false, message: 'Incorrect password.' });
        return;
      }
    }

    // Guard: block deletion while the user is the sole owner of workspaces
    // that have other members - ownership must be transferred first.
    // Workspaces owned without other members are deleted via cascade.
    const guardedWorkspaces = await prisma.workspace.findMany({
      where: {
        ownerId: userId,
        members: { some: { userId: { not: userId } } },
      },
      select: { id: true, name: true, slug: true },
    });

    if (guardedWorkspaces.length > 0) {
      res.status(409).json({
        success: false,
        message: 'Transfer ownership of the workspaces below before deleting your account.',
        data: { workspaces: guardedWorkspaces },
      });
      return;
    }

    // Delete the user first (everything else cascades). Null out the
    // nullable FKs that would otherwise block the cascade delete.
    await prisma.$transaction([
      prisma.notification.updateMany({ where: { senderId: userId }, data: { senderId: null } }),
      prisma.integration.updateMany({ where: { connectedById: userId }, data: { connectedById: null } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    // Lock out immediately: revoke refresh tokens + tracked sessions, then
    // invalidate caches. Deletion already invalidates the access token
    // (authenticate reads the user from the DB), so revoking after deletion
    // never strands an account if the delete itself fails.
    await revokeAllRefreshTokens(userId);
    const sessions = await getUserActiveSessions(userId);
    for (const session of sessions) {
      await markSessionRevoked(session.sessionId);
      await revokeUserSession(userId, session.sessionId);
    }
    await UserCache.invalidateProfile(userId);
    await WorkspaceCache.invalidateUserWorkspaces(userId);

    auditLog('DATA_DELETION', {
      userId,
      email,
      reason: 'Self-service account deletion',
      meta: { guardedWorkspaces: guardedWorkspaces.length },
    });

    res.status(200).json({ success: true, message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
};
