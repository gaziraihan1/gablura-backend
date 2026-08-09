/**
 * modules/templates/templates.routes.ts
 *
 * Route design:
 *  - Catalog + detail are PUBLIC (the templates page is a marketing page).
 *  - Import, save-as-template, private listing, update and delete require
 *    authentication + session timeout + CSRF (per-route, so the public
 *    `/:slug` detail route mounted after never inherits auth).
 *  - Route ordering matters: static segments (`/catalog`, `/private`,
 *    `/save-as-template/:projectId`) are declared before `/:slug` so they are
 *    never shadowed by the parameter route.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import { sessionTimeout } from '../../middleware/sessionTimeout.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { requireFocuraAdmin } from '../../middleware/focuraAdmin.js';
import {
  getCatalog,
  getTemplateDetail,
  getWorkspacePrivateTemplates,
  useTemplate,
  saveAsTemplate,
  updateTemplate,
  deleteTemplate,
  rateTemplate,
  requestTemplate,
  listTemplateRequests,
  removeTemplateRequest,
} from './templates.controller.js';

const router = Router();
const authedRouter = Router();

// Save/import are rate-limited because they snapshot + write a full project.
authedRouter.get(
  '/private',
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  getWorkspacePrivateTemplates,
);
authedRouter.post(
  '/save-as-template/:projectId',
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  rateLimitMiddleware(20, 600),
  saveAsTemplate,
);
authedRouter.post(
  '/:slug/use',
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  rateLimitMiddleware(10, 600),
  useTemplate,
);
authedRouter.post(
  '/:slug/rate',
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  rateLimitMiddleware(30, 600),
  rateTemplate,
);
authedRouter.patch('/:slug', authenticate, sessionTimeout, requireCsrfToken(), updateTemplate);

// Admin waitlist removal. Emails always contain "@" (template slugs never do),
// so this and DELETE /:slug below share the :param pattern without colliding.
// The "@" check runs BEFORE requireFocuraAdmin so slug params fall through to
// the template-delete route — otherwise non-admin template authors would be
// blocked by the admin gate and never reach their own DELETE /:slug.
authedRouter.delete(
  '/:email',
  authenticate,
  sessionTimeout,
  requireCsrfToken(),
  (req, res, next) => {
    if (!req.params.email.includes('@')) return next();
    requireFocuraAdmin(req, res, (err?: unknown) => {
      if (err) return next(err);
      void removeTemplateRequest(req, res, next);
    });
  },
);
authedRouter.delete('/:slug', authenticate, sessionTimeout, requireCsrfToken(), deleteTemplate);

// ── Public ───────────────────────────────────────────────────────────────────
// Template-waitlist email capture (public, rate limited like other public forms).
router.post('/', rateLimitMiddleware(5, 600), requestTemplate);
router.get('/catalog', getCatalog);

// Admin waitlist listing — registered on the root path so GET /:slug never
// shadows it (Express only matches /:slug against non-empty segments).
router.get('/', authenticate, sessionTimeout, requireCsrfToken(), requireFocuraAdmin, listTemplateRequests);

router.use(authedRouter);
router.get('/:slug', getTemplateDetail);

export default router;
