import { Router }          from 'express';
import { publicListJobs,
         publicGetJob,
         adminListJobs,
         adminCreateJob,
         adminUpdateJob,
         adminDeleteJob,
         adminTogglePin } from './job.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// ── Public ─────────────────────────────────────────────────────────────────────
router.get('/',          publicListJobs);
router.get('/:slug',     publicGetJob);

// ── Admin (GABLURA_ADMIN_IDS) ───────────────────────────────────────────────────
router.use(authenticate)
router.get   ('/admin/all',          adminListJobs);
router.post  ('/admin',              adminCreateJob);
router.put   ('/admin/:id',          adminUpdateJob);
router.delete('/admin/:id',          adminDeleteJob);
router.patch ('/admin/:id/pin',      adminTogglePin);

export default router;