import { prisma } from "../../lib/prisma.js";
import {
  CreatePopularResourceInput,
  UpdatePopularResourceInput,
  CreateProductUpdateInput,
  UpdateProductUpdateInput,
} from "./resource.types.js";

// ─── Popular Resource writes ───────────────────────────────────────────────
// Note: update/delete on a missing id throws Prisma's P2025, which your
// existing global errorHandler already turns into a 404 — no need to
// pre-check existence here.

import { SlugService } from "../../services/slug.service.js";

export async function createPopularResource(
  data: CreatePopularResourceInput,
  userId: string
) {
  const slug = await SlugService.generatePopularResourceSlug(data.title);

  return prisma.popularResource.create({
    data: {
      ...data,
      slug,
      createdById: userId,
    },
  });
}

export const updatePopularResource = async (slug: string, data: UpdatePopularResourceInput) =>
  prisma.popularResource.update({ where: { slug }, data });

export const deletePopularResource = async (slug: string) =>
  prisma.popularResource.delete({ where: { slug } });

// ─── Product Update writes ─────────────────────────────────────────────────

export const createProductUpdate = async (
  data: CreateProductUpdateInput,
  createdById: string,
) => {
  const slug = await SlugService.generateProductUpdateSlug(data.title);
  return prisma.productUpdate.create({ data: { ...data, slug, createdById } });
};

export const updateProductUpdate = async (slug: string, data: UpdateProductUpdateInput) =>
  prisma.productUpdate.update({ where: { slug }, data });

export const deleteProductUpdate = async (slug: string) =>
  prisma.productUpdate.delete({ where: { slug } });