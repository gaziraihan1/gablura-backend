/**
 * modules/templates/templates.query.ts
 */
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import { assertWorkspaceMembership } from './templates.access.js';
import type {
  TemplateCatalogItem,
  TemplateCatalogResponse,
  TemplateTier,
} from './templates.types.js';

const catalogSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  longDescription: true,
  category: true,
  complexity: true,
  tier: true,
  icon: true,
  color: true,
  tags: true,
  usageCount: true,
  ratingSum: true,
  ratingCount: true,
  estimatedSetupMinutes: true,
  status: true,
  featured: true,
  visibility: true,
  authorName: true,
  authorRole: true,
  content: true,
} as const;

type CatalogRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  longDescription: string | null;
  category: string;
  complexity: string;
  tier: TemplateTier;
  icon: string | null;
  color: string | null;
  tags: unknown;
  usageCount: number;
  ratingSum: number;
  ratingCount: number;
  estimatedSetupMinutes: number;
  status: string;
  featured: boolean;
  visibility: string;
  authorName: string | null;
  authorRole: string | null;
  content: unknown;
};

function toCatalogItem(row: CatalogRow): TemplateCatalogItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    longDescription: row.longDescription,
    category: row.category,
    complexity: row.complexity,
    tier: row.tier,
    icon: row.icon,
    color: row.color,
    tags: row.tags,
    usageCount: row.usageCount,
    estimatedSetupMinutes: row.estimatedSetupMinutes,
    status: row.status,
    rating: {
      average:
        row.ratingCount > 0
          ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10
          : 0,
      count: row.ratingCount,
    },
    featured: row.featured,
    author: row.authorName
      ? { name: row.authorName, role: row.authorRole }
      : null,
    content: row.content as TemplateCatalogItem['content'],
  };
}

/**
 * The highest tier the user can access, derived from the plans of the
 * workspaces they own OR belong to. The import gate checks the destination
 * workspace's plan, so a member of a paid workspace must see those templates
 * as unlocked (not just owners). Logged-out or Free-only users resolve to FREE.
 */
export async function resolveUserAccessTier(userId?: string): Promise<TemplateTier> {
  if (!userId) return 'FREE';

  const [owned, memberRows] = await Promise.all([
    prisma.workspace.findMany({ where: { ownerId: userId }, select: { plan: true } }),
    prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspace: { select: { plan: true } } },
    }),
  ]);

  const plans = new Set<string>();
  for (const w of owned) plans.add(w.plan as string);
  for (const m of memberRows) {
    if (m.workspace?.plan) plans.add(m.workspace.plan as string);
  }
  if (plans.has('ENTERPRISE') || plans.has('BUSINESS')) return 'BUSINESS';
  if (plans.has('PRO')) return 'PRO';
  return 'FREE';
}

export const TemplateQuery = {
  /** Public catalog — available templates only, with the caller's access tier. */
  async getCatalog(
    userId: string | undefined,
    filters: {
      category?: string;
      search?: string;
      tier?: TemplateTier;
      featured?: boolean;
    },
  ): Promise<TemplateCatalogResponse> {
    const where: Record<string, unknown> = {
      visibility: 'PUBLIC',
      status: { in: ['available', 'coming_soon'] },
    };
    if (filters.category && filters.category !== 'all') {
      where.category = filters.category;
    }
    if (filters.tier) where.tier = filters.tier;
    if (filters.featured) where.featured = true;
    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.projectTemplate.findMany({
      where,
      orderBy: filters.featured
        ? [{ usageCount: 'desc' }, { ratingCount: 'desc' }, { title: 'asc' }]
        : [{ tier: 'asc' }, { usageCount: 'desc' }, { title: 'asc' }],
      select: catalogSelect,
    });

    const accessTier = await resolveUserAccessTier(userId);

    return {
      templates: rows.map(toCatalogItem),
      access: { tier: accessTier },
    };
  },

  /** Public detail by slug. */
  async getBySlug(slug: string): Promise<TemplateCatalogItem> {
    const row = await prisma.projectTemplate.findUnique({
      where: { slug },
      select: catalogSelect,
    });
    if (!row || row.visibility !== 'PUBLIC' || row.status === 'archived') {
      throw new NotFoundError('Template not found');
    }
    return toCatalogItem(row);
  },

  /** Private templates saved from a workspace (members only). */
  async getWorkspacePrivate(userId: string, workspaceId: string) {
    await assertWorkspaceMembership(userId, workspaceId);

    const rows = await prisma.projectTemplate.findMany({
      where: { workspaceId, visibility: 'PRIVATE' },
      orderBy: { createdAt: 'desc' },
      select: catalogSelect,
    });
    return rows.map(toCatalogItem);
  },
};
