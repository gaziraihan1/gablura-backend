import { prisma } from "../../lib/prisma.js";
import {
  PopularResourceListFilters,
  ProductUpdateListFilters,
  PaginatedResult,
  PopularResourceDTO,
  ProductUpdateDTO,
  ResourceStatus,
} from "./resource.types.js";

// ─── Popular Resource reads ────────────────────────────────────────────────

export const findPopularResources = async (
  filters: PopularResourceListFilters,
): Promise<PaginatedResult<PopularResourceDTO>> => {
  const { status, category, page, limit } = filters;
  const where = {
    ...(status && { status }),
    ...(category && { category }),
  };

  const [items, total] = await Promise.all([
    prisma.popularResource.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.popularResource.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

export const findPopularResourceBySlug = async (slug: string) =>
  prisma.popularResource.findUnique({ where: { slug } });

/** Public variant — only ever returns PUBLIC resources, regardless of caller input. */
export const findPublicPopularResources = async (
  filters: Omit<PopularResourceListFilters, "status">,
): Promise<PaginatedResult<PopularResourceDTO>> =>
  findPopularResources({ ...filters, status: ResourceStatus.PUBLIC });

export const findPublicPopularResourceBySlug = async (slug: string) =>
  prisma.popularResource.findFirst({ where: { slug, status: ResourceStatus.PUBLIC } });

// ─── Product Update reads ──────────────────────────────────────────────────

export const findProductUpdates = async (
  filters: ProductUpdateListFilters,
): Promise<PaginatedResult<ProductUpdateDTO>> => {
  const { status, page, limit } = filters;
  const where = { ...(status && { status }) };

  const [items, total] = await Promise.all([
    prisma.productUpdate.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.productUpdate.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

export const findProductUpdateBySlug = async (slug: string) =>
  prisma.productUpdate.findUnique({ where: { slug } });

export const findPublicProductUpdates = async (
  filters: Omit<ProductUpdateListFilters, "status">,
): Promise<PaginatedResult<ProductUpdateDTO>> =>
  findProductUpdates({ ...filters, status: ResourceStatus.PUBLIC });

export const findPublicProductUpdateBySlug = async (slug: string) =>
  prisma.productUpdate.findFirst({ where: { slug, status: ResourceStatus.PUBLIC } });