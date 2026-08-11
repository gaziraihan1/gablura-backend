import { Response, NextFunction } from 'express';
import { isFocuraAdminUser } from '../../config/admin.config.js';
import { AuthRequest } from '../../middleware/auth.js';

export function requireAdminId(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const userId: string | undefined = req.user?.id;

  if (!userId || !isFocuraAdminUser(req.user?.role, userId)) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
    return;
  }

  next();
}