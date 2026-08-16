import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import { upload } from '../../middleware/upload.js';
import { uploadFile } from './upload.controller.js';
import { requireFileSizeLimit } from '../billing/index.js';

// Reject malformed workspace IDs before the plan guard (requireFileSizeLimit)
// looks the workspace up and 404s on it, keeping the API contract stable:
// invalid format → 400, missing/valid-but-unknown → handled downstream.
function validateWorkspaceIdFormat(req: Request, res: Response, next: NextFunction) {
  const workspaceId = req.body?.workspaceId;
  if (workspaceId && (typeof workspaceId !== 'string' || !/^c[a-z0-9]{24,}$/i.test(workspaceId))) {
    res.status(400).json({ success: false, message: 'Invalid workspace ID format' });
    return;
  }
  next();
}

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
// Runs before multer so over-limit uploads are rejected before the file is
// processed; the plan's per-file size limit still applies downstream.
router.use(rateLimitUserApi);

// Runs after multer so req.body.workspaceId is available; content-length
// still reflects the full request so the plan's per-file limit is enforced.
router.post('/', upload.single('file'), validateWorkspaceIdFormat, requireFileSizeLimit, uploadFile);

export default router;
