import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { isGabluraAdminUser } from '../config/admin.config.js';

export const requireGabluraAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
  const userId = req.user?.id;
  const userRole = req.user?.role;

  // If there is no authenticated user, respond with 401
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
      code: 'NOT_AUTHENTICATED',
    });
  }

  // Require both ADMIN role AND GABLURA_ADMIN_IDS registration
  if (!isGabluraAdminUser(userRole, userId)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Admin access required',
      code: 'FORBIDDEN',
    });
  }

  next();
  } catch (error) {
    console.error('GabluraAdminMiddleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};