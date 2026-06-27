import { Response } from "express";
import { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../errors/asyncHandler.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import * as resourceQueries from "./resource.query.js";
import * as resourceMutations from "./resource.mutation.js";
import {
  createPopularResourceSchema,
  updatePopularResourceSchema,
  createProductUpdateSchema,
  updateProductUpdateSchema,
} from "./resource.validation.js";

// ─── helpers ────────────────────────────────────────────────────────────

function parseListQuery(query: any, defaultLimit: number) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limitRaw = parseInt(query.limit, 10);
  const limit = Math.min(100, limitRaw > 0 ? limitRaw : defaultLimit);
  return { page, limit };
}

function requireSlug(slug: unknown): string {
  if (typeof slug !== "string" || !slug.trim()) {
    throw new ValidationError("Validation failed", [
      { path: "slug", message: "Slug is required" },
    ]);
  }
  return slug;
}

function parseBody<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err: any) {
    if (err?.issues) {
      throw new ValidationError(
        "Validation failed",
        err.issues.map((e: any) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      );
    }
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════
// ADMIN — Popular Resource
// ════════════════════════════════════════════════════════════════════════

export const adminListPopularResources = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const { status, category } = req.query as any;
    const { page, limit } = parseListQuery(req.query, 8);
    const result = await resourceQueries.findPopularResources({
      status,
      category,
      page,
      limit,
    });
    res.json({ success: true, data: result });
  },
);

export const adminGetPopularResource = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    const resource = await resourceQueries.findPopularResourceBySlug(slug);
    if (!resource) throw new NotFoundError("Popular resource");
    res.json({ success: true, data: resource });
  },
);

export const adminCreatePopularResource = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const data = parseBody(createPopularResourceSchema, req.body);
    const resource = await resourceMutations.createPopularResource(
      data,
      req.user?.id!,
    );
    res
      .status(201)
      .json({
        success: true,
        data: resource,
        message: "Popular resource created",
      });
  },
);

export const adminUpdatePopularResource = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    const data = parseBody(updatePopularResourceSchema, req.body);
    const resource = await resourceMutations.updatePopularResource(slug, data);
    res.json({
      success: true,
      data: resource,
      message: "Popular resource updated",
    });
  },
);

export const adminDeletePopularResource = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    await resourceMutations.deletePopularResource(slug);
    res.status(204).send();
  },
);

// ════════════════════════════════════════════════════════════════════════
// ADMIN — Product Update
// ════════════════════════════════════════════════════════════════════════

export const adminListProductUpdates = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const { status } = req.query as any;
    const { page, limit } = parseListQuery(req.query, 20);
    const result = await resourceQueries.findProductUpdates({
      status,
      page,
      limit,
    });
    res.json({ success: true, data: result });
  },
);

export const adminGetProductUpdate = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    const update = await resourceQueries.findProductUpdateBySlug(slug);
    if (!update) throw new NotFoundError("Product update");
    res.json({ success: true, data: update });
  },
);

export const adminCreateProductUpdate = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const data = parseBody(createProductUpdateSchema, req.body);
    const update = await resourceMutations.createProductUpdate(
      data,
      req.user?.id!,
    );
    res
      .status(201)
      .json({ success: true, data: update, message: "Product update created" });
  },
);

export const adminUpdateProductUpdate = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    const data = parseBody(updateProductUpdateSchema, req.body);
    const update = await resourceMutations.updateProductUpdate(slug, data);
    res.json({ success: true, data: update, message: "Product update saved" });
  },
);

export const adminDeleteProductUpdate = asyncHandler<AuthRequest>(
  async (req, res: Response) => {
    const slug = requireSlug(req.params.slug);
    await resourceMutations.deleteProductUpdate(slug);
    res.status(204).send();
  },
);

// ════════════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════════════

export const publicListPopularResources = asyncHandler(async (req, res) => {
  const { category } = req.query as any;
  const { page, limit } = parseListQuery(req.query, 8);
  const result = await resourceQueries.findPublicPopularResources({
    category,
    page,
    limit,
  });
  res.json({ success: true, data: result });
});

export const publicGetPopularResource = asyncHandler(async (req, res) => {
  const slug = requireSlug(req.params.slug);
  const resource = await resourceQueries.findPublicPopularResourceBySlug(slug);
  if (!resource) throw new NotFoundError("Popular resource");
  res.json({ success: true, data: resource });
});

export const publicListProductUpdates = asyncHandler(async (req, res) => {
  const { page, limit } = parseListQuery(req.query, 20);
  const result = await resourceQueries.findPublicProductUpdates({
    page,
    limit,
  });
  res.json({ success: true, data: result });
});

export const publicGetProductUpdate = asyncHandler(async (req, res) => {
  const slug = requireSlug(req.params.slug);
  const update = await resourceQueries.findPublicProductUpdateBySlug(slug);
  if (!update) throw new NotFoundError("Product update");
  res.json({ success: true, data: update });
});
