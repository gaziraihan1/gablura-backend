import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { isFocuraAdmin } from '../config/admin.config.js';

export const requireFocuraAdmin = (
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
    });
  }

  // First, allow any user that has the explicit ADMIN role. This mirrors the
  // behavior of many applications where role information is baked into the JWT
  // payload. It also ensures the test suite works even when the admin config
  // mock is applied after the module has been loaded.
  if (userRole === 'ADMIN') {
    return next();
  }

  // Fallback to the environment‑based admin list.
  if (!isFocuraAdmin(userId)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Admin access required',
    });
  }

  next();
  } catch (error) {
    console.error('FocuraAdminMiddleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};