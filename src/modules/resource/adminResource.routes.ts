import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireFocuraAdmin } from "../../middleware/focuraAdmin.js"; // adjust path if yours
// lives elsewhere
import { resourceController } from "./index.js";
const router = Router();

// ─── Admin: Popular Resource ───────────────────────────────────────────────

router.get(
  "/popular",
  requireFocuraAdmin,
  resourceController.adminListPopularResources,
);
router.get(
  "/popular/:slug",
  authenticate,
  requireFocuraAdmin,
  resourceController.adminGetPopularResource,
);
router.post(
  "/popular",
  requireFocuraAdmin,
  resourceController.adminCreatePopularResource,
);
router.patch(
  "/popular/:slug",
  requireFocuraAdmin,
  resourceController.adminUpdatePopularResource,
);
router.delete(
  "/popular/:slug",
  requireFocuraAdmin,
  resourceController.adminDeletePopularResource,
);

router.get(
  "/product-updates",
  requireFocuraAdmin,
  resourceController.adminListProductUpdates,
);
router.get(
  "/product-updates/:slug",
  requireFocuraAdmin,
  resourceController.adminGetProductUpdate,
);
router.post(
  "/product-updates",
  requireFocuraAdmin,
  resourceController.adminCreateProductUpdate,
);
router.patch(
  "/product-updates/:slug",
  requireFocuraAdmin,
  resourceController.adminUpdateProductUpdate,
);
router.delete(
  "/product-updates/:slug",
  requireFocuraAdmin,
  resourceController.adminDeleteProductUpdate,
);
export default router;
