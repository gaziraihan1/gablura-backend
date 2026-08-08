import { Router }           from 'express';
import { BillingController } from './billing.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';

const router = Router({ mergeParams: true }); // mergeParams = inherit :workspaceId from parent

router.use(authenticate);

// 10 checkout/portal session creations per 5 minutes per IP — enough for
// normal upgrade flows, not enough to spam Stripe session creation.
router.post('/create-checkout-session',  rateLimitMiddleware(10, 300), BillingController.createCheckoutSession);
router.post('/create-portal-session',    rateLimitMiddleware(10, 300), BillingController.createPortalSession);
router.get ('/subscription',             BillingController.getSubscription);
router.post('/change-plan',              BillingController.changePlan);
router.post('/cancel-subscription',      BillingController.cancelSubscription);
router.post('/reactivate-subscription',  BillingController.reactivateSubscription);
router.get ('/invoices',                 BillingController.getInvoices);

export default router;