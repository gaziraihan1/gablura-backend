import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { generateTOTPSecret, createTOTPURI, verifyTOTPToken } from '../lib/totp.js';
import argon2 from 'argon2';

/**
 * Get security settings for the current user.
 * GET /api/v1/user/security
 */
export const getSecuritySettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        twoFactorEnabled: true,
        emailVerified: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        twoFactorEnabled: user.twoFactorEnabled,
        emailVerified: user.emailVerified !== null,
        lastPasswordChange: null,
      },
    });
  } catch (error) {
    console.error('Get security settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch security settings',
    });
  }
};

/**
 * Generate a TOTP secret, store it temporarily, and return the setup URI.
 * POST /api/v1/user/2fa/setup
 */
export const setupTwoFactor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { twoFactorEnabled: true, email: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.twoFactorEnabled) {
      res.status(400).json({
        success: false,
        message: 'Two-factor authentication is already enabled',
      });
      return;
    }

    const secret = generateTOTPSecret();
    const uri = createTOTPURI(secret, user.email!);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorSecret: secret },
    });

    res.status(200).json({
      success: true,
      data: { secret, uri },
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set up two-factor authentication',
    });
  }
};

/**
 * Verify a TOTP code and enable 2FA.
 * POST /api/v1/user/2fa/verify
 */
export const verifyTwoFactor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Verification code is required',
      });
      return;
    }

    if (token.length !== 6 || !/^\d{6}$/.test(token)) {
      res.status(400).json({
        success: false,
        message: 'Verification code must be a 6-digit number',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.twoFactorEnabled) {
      res.status(400).json({
        success: false,
        message: 'Two-factor authentication is already enabled',
      });
      return;
    }

    if (!user.twoFactorSecret) {
      res.status(400).json({
        success: false,
        message: 'No 2FA setup in progress. Please start setup first.',
      });
      return;
    }

    const isValid = await verifyTOTPToken(token.trim(), user.twoFactorSecret);
    if (!isValid) {
      res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please try again.',
      });
      return;
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorEnabled: true },
    });

    res.status(200).json({
      success: true,
      message: 'Two-factor authentication enabled successfully.',
    });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify two-factor authentication code',
    });
  }
};

/**
 * Disable 2FA (requires current password for credential users).
 * POST /api/v1/user/2fa/disable
 */
export const disableTwoFactor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Current password is required to disable 2FA',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { password: true, twoFactorEnabled: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (!user.twoFactorEnabled) {
      res.status(400).json({
        success: false,
        message: 'Two-factor authentication is not enabled',
      });
      return;
    }

    if (user.password) {
      const isValid = await argon2.verify(user.password, password);
      if (!isValid) {
        res.status(401).json({
          success: false,
          message: 'Invalid password',
        });
        return;
      }
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Two-factor authentication disabled successfully.',
    });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable two-factor authentication',
    });
  }
};
