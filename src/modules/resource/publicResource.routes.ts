import { Router } from "express";
import { resourceController } from "./index.js";

const router = Router();

router.get("/popular", resourceController.publicListPopularResources);

router.get("/popular/:slug", resourceController.publicGetPopularResource);

router.get("/product-updates", resourceController.publicListProductUpdates);

router.get("/product-updates/:slug", resourceController.publicGetProductUpdate);

export default router;
