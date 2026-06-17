import slugify from "slugify";
import { prisma } from "../lib/prisma.js";

export class SlugService {
  static async generateWorkspaceSlug(name: string): Promise<string> {
    const base = slugify.default(name, { lower: true, strict: true });

    const matches = await prisma.workspace.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });

    if (matches.length === 0) return base;

    return `${base}-${matches.length + 1}`;
  }

  static async generateProjectSlug(
    name: string,
    workspaceId: string
  ): Promise<string> {
    const base = slugify.default(name, { lower: true, strict: true });

    const matches = await prisma.project.findMany({
      where: {
        workspaceId,
        slug: { startsWith: base },
      },
      select: { slug: true },
    });

    if (matches.length === 0) return base;

    return `${base}-${matches.length + 1}`;
  }

  static async generatePopularResourceSlug(
    title: string
  ): Promise<string> {
    const base = slugify.default(title, {
      lower: true,
      strict: true,
    });

    const matches = await prisma.popularResource.findMany({
      where: {
        slug: {
          startsWith: base,
        },
      },
      select: {
        slug: true,
      },
    });

    if (matches.length === 0) return base;

    return `${base}-${matches.length + 1}`;
  }

  static async generateProductUpdateSlug(
    title: string
  ): Promise<string> {
    const base = slugify.default(title, {
      lower: true,
      strict: true,
    });

    const matches = await prisma.productUpdate.findMany({
      where: {
        slug: {
          startsWith: base,
        },
      },
      select: {
        slug: true,
      },
    });

    if (matches.length === 0) return base;

    return `${base}-${matches.length + 1}`;
  }
}