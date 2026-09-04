import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireGabluraAdmin } from "../../middleware/focuraAdmin.js"; // adjust path if yours
// lives elsewhere
import { resourceController } from "./index.js";
const router = Router();

// ─── Admin: Popular Resource ───────────────────────────────────────────────

router.get(
  "/popular",
  requireGabluraAdmin,
  resourceController.adminListPopularResources,
);
router.get(
  "/popular/:slug",
  authenticate,
  requireGabluraAdmin,
  resourceController.adminGetPopularResource,
);
router.post(
  "/popular",
  requireGabluraAdmin,
  resourceController.adminCreatePopularResource,
);
router.patch(
  "/popular/:slug",
  requireGabluraAdmin,
  resourceController.adminUpdatePopularResource,
);
router.delete(
  "/popular/:slug",
  requireGabluraAdmin,
  resourceController.adminDeletePopularResource,
);

router.get(
  "/product-updates",
  requireGabluraAdmin,
  resourceController.adminListProductUpdates,
);
router.get(
  "/product-updates/:slug",
  requireGabluraAdmin,
  resourceController.adminGetProductUpdate,
);
router.post(
  "/product-updates",
  requireGabluraAdmin,
  resourceController.adminCreateProductUpdate,
);
router.patch(
  "/product-updates/:slug",
  requireGabluraAdmin,
  resourceController.adminUpdateProductUpdate,
);
router.delete(
  "/product-updates/:slug",
  requireGabluraAdmin,
  resourceController.adminDeleteProductUpdate,
);
export default router;
