/**
 * modules/templates/templates.types.ts
 *
 * Shared types for the ProjectTemplate module — the tier-gated template
 * catalog (official + user-saved) and the import/save operations that
 * snapshot and clone project structures.
 */

export type TemplateTier = 'FREE' | 'PRO' | 'BUSINESS';

/**
 * Visibility lifecycle: PRIVATE (workspace draft) → PENDING (community
 * submission awaiting Focura-admin review) → PUBLIC (in the gallery).
 * Only admins move templates to PUBLIC — see the moderation endpoints.
 */
export type TemplateVisibility = 'PRIVATE' | 'PENDING' | 'PUBLIC';

/**
 * True when a workspace plan (FREE/PRO/BUSINESS/ENTERPRISE) can use a
 * template of the given tier. ENTERPRISE is a superset of BUSINESS.
 */
export function canAccessTier(
  workspacePlan: string | null | undefined,
  templateTier: TemplateTier,
): boolean {
  switch (workspacePlan) {
    case 'ENTERPRISE':
    case 'BUSINESS':
      return true; // everything
    case 'PRO':
      return templateTier === 'FREE' || templateTier === 'PRO';
    default:
      return templateTier === 'FREE';
  }
}

/** The snapshot stored in `ProjectTemplate.content`. */
export interface TemplateContent {
  sections: Array<{
    name: string;
    description?: string | null;
    color?: string | null;
    taskStatus?: string | null;
    wipLimit?: number | null;
  }>;
  labels: Array<{ name: string; color: string }>;
  tasks: Array<{
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    section?: string | null;
    label?: string | null;
  }>;
  milestones: Array<{ title: string; dueWeek: number }>;
  views: Array<{ name: string; type: string }>;
}

/** Public catalog record returned to the templates page. */
export interface TemplateCatalogItem {
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
  estimatedSetupMinutes: number;
  status: string;
  visibility: TemplateVisibility;
  rating: { average: number; count: number };
  featured: boolean;
  author: { name: string | null; role: string | null } | null;
  content: TemplateContent;
}

export interface TemplateCatalogResponse {
  templates: TemplateCatalogItem[];
  access: { tier: TemplateTier };
}

export interface TemplateImportResult {
  /** Slug of the newly created project (deep-link target). */
  projectSlug: string;
  workspaceSlug: string;
}

/**
 * Admin moderation queue item — a community submission awaiting review.
 * The queue lists only PENDING templates (never PRIVATE or already-PUBLIC).
 */
export interface TemplateModerationItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  complexity: string;
  tier: TemplateTier;
  icon: string | null;
  color: string | null;
  status: string;
  visibility: TemplateVisibility;
  usageCount: number;
  rating: { average: number; count: number };
  featured: boolean;
  author: { name: string | null; role: string | null } | null;
  workspaceId: string | null;
  createdAt: Date | string;
  taskCount: number;
  sectionCount: number;
}
