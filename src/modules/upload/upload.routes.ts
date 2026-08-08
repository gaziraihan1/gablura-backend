
import { Router } from 'express';
import { upload } from '../../middleware/upload.js';
import { uploadFile } from './upload.controller.js';
import { requireFileSizeLimit } from '../billing/index.js';

const router = Router();

// Runs after multer so req.body.workspaceId is available; content-length
// still reflects the full request so the plan's per-file limit is enforced.
router.post('/', upload.single('file'), requireFileSizeLimit, uploadFile);

export default router;