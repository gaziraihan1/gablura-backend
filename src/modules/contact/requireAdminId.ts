import { Response, NextFunction } from 'express';
import { isGabluraAdminUser } from '../../config/admin.config.js';
import { AuthRequest } from '../../middleware/auth.js';

export function requireAdminId(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const userId: string | undefined = req.user?.id;

  if (!userId || !isGabluraAdminUser(req.user?.role, userId)) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
    return;
  }

  next();
}