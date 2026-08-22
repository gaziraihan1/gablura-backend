/**
 * modules/templates/templates.mutation.ts
 *
 * Import: clones a template's full snapshot into a new project inside a single
 * Prisma transaction — either every child (sections, labels, tasks,
 * milestones, views) is created or none is.
 *
 * Save: snapshots a project's structure into a PRIVATE ProjectTemplate.
 */
import * as slugifyModule from 'slugify';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, PlanLimitError, ValidationError } from '../../errors/index.js';
import { SlugService } from '../../services/slug.service.js';
import { resolveWorkspacePlan } from '../task/task.quota.service.js';
import { PLAN_LIMITS } from '../workspaceUsage/workspaceUsage.types.js';
import { addBatchInvalidateCacheJob } from '../../queue/index.js';
import {
  ProjectCache,
  WorkspaceCache,
  AnalyticsCache,
} from '../../lib/redis/cache.client.js';
import { assertProjectEditAccess, assertWorkspaceMembership, assertCanManageTemplate } from './templates.access.js';
import { resolveUserAccessTier } from './templates.query.js';
import { canAccessTier } from './templates.types.js';
import type {
  TemplateContent,
  TemplateImportResult,
  TemplateTier,
  TemplateVisibility,
} from './templates.types.js';
import type { AuthRequest } from '../../middleware/auth.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slugify = (slugifyModule as any).default || slugifyModule;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Project quota limit for a workspace plan (FREE = 3, paid = unlimited). */
async function assertUnderProjectQuota(workspaceId: string): Promise<void> {
  const plan = await resolveWorkspacePlan(workspaceId);
  const limit = PLAN_LIMITS[plan]?.projects ?? PLAN_LIMITS.FREE.projects;
  if (limit === -1) return;

  const current = await prisma.project.count({ where: { workspaceId } });
  if (current >= limit) {
    throw new PlanLimitError(
      `Project limit reached (${limit} projects on your current plan). Upgrade to import more projects.`,
    );
  }
}

/** Map a workspace plan (FREE/PRO/BUSINESS/ENTERPRISE) to a template tier. */
function planToTier(plan: string): TemplateTier {
  if (plan === 'BUSINESS' || plan === 'ENTERPRISE') return 'BUSINESS';
  if (plan === 'PRO') return 'PRO';
  return 'FREE';
}

function createContentSnapshot(input: {
  sections: Array<{
    name: string;
    description: string | null;
    color: string | null;
    taskStatus: string | null;
    wipLimit: number | null;
  }>;
  labels: Array<{ name: string; color: string }>;
  tasks: Array<{
    title: string;
    status: string;
    priority: string;
    sectionName: string | null;
    labelName: string | null;
  }>;
  milestones: Array<{ title: string; dueDate: Date | null }>;
  views: Array<{ name: string; type: string }>;
}): TemplateContent {
  const anchor = new Date();

  return {
    sections: input.sections.map((s) => ({
      name: s.name,
      description: s.description,
      color: s.color,
      taskStatus: s.taskStatus,
      wipLimit: s.wipLimit,
    })),
    labels: input.labels.map((l) => ({ name: l.name, color: l.color })),
    tasks: input.tasks.map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      section: t.sectionName,
      label: t.labelName,
    })),
    milestones: input.milestones.map((m) => ({
      title: m.title,
      dueWeek: m.dueDate
        ? Math.max(-52, Math.min(52, Math.round((m.dueDate.getTime() - anchor.getTime()) / WEEK_MS)))
        : 0,
    })),
    views: input.views.map((v) => ({ name: v.name, type: v.type })),
  };
}

export const TemplateMutation = {
  /**
   * Import a public template into a workspace as a brand-new project.
   * Atomic: all children are created (or none) inside one $transaction.
   */
  async use(
    userId: string,
    slug: string,
    input: { workspaceId: string; projectName?: string },
  ): Promise<TemplateImportResult> {
    const template = await prisma.projectTemplate.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        icon: true,
        color: true,
        tier: true,
        status: true,
        visibility: true,
        content: true,
      },
    });
    if (!template || template.visibility !== 'PUBLIC' || template.status !== 'available') {
      throw new NotFoundError('Template not found');
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { id: true, slug: true },
    });
    if (!workspace) throw new NotFoundError('Workspace not found');
    await assertWorkspaceMembership(userId, input.workspaceId);

    // Tier gate — the destination workspace's plan decides what can be used.
    const plan = await resolveWorkspacePlan(input.workspaceId);
    if (!canAccessTier(plan, template.tier)) {
      const needs = template.tier === 'BUSINESS' ? 'Business' : 'Pro';
      throw new PlanLimitError(
        `This template requires the ${needs} plan. Upgrade ${workspace.slug} to unlock it.`,
      );
    }
    await assertUnderProjectQuota(input.workspaceId);

    const name = input.projectName?.trim() || template.title;
    const projectSlug = await SlugService.generateProjectSlug(name, input.workspaceId);
    const content = template.content as unknown as TemplateContent;

    await prisma.$transaction(async (tx) => {
      // 1. Project
      const project = await tx.project.create({
        data: {
          name,
          slug: projectSlug,
          description: template.description,
          color: template.color ?? '#667eea',
          icon: template.icon,
          status: 'ACTIVE',
          priority: 'MEDIUM',
          workspace: { connect: { id_slug: { id: workspace.id, slug: workspace.slug } } },
          createdBy: { connect: { id: userId } },
        },
      });

      // 2. Sections (status-driven workflow columns; one status per section)
      const sectionIds = new Map<string, string>();
      const usedStatuses = new Set<string>();
      for (const [index, section] of (content.sections ?? []).entries()) {
        const taskStatus =
          section.taskStatus && !usedStatuses.has(section.taskStatus)
            ? section.taskStatus
            : null;
        if (taskStatus) usedStatuses.add(taskStatus);
        const created = await tx.projectSection.create({
          data: {
            name: section.name,
            description: section.description ?? null,
            color: section.color ?? null,
            taskStatus: (taskStatus as never) ?? null,
            wipLimit: section.wipLimit ?? null,
            position: index,
            projectId: project.id,
          },
        });
        sectionIds.set(section.name, created.id);
      }

      // 3. Labels (workspace-scoped, upserted by name so duplicates are reused)
      const labelIds = new Map<string, string>();
      for (const label of content.labels ?? []) {
        const created = await tx.label.upsert({
          where: { workspaceId_name: { workspaceId: workspace.id, name: label.name } },
          create: {
            name: label.name,
            color: label.color,
            workspaceId: workspace.id,
            createdById: userId,
          },
          update: { color: label.color },
        });
        labelIds.set(label.name, created.id);
      }

      // 4. Tasks (section + label resolved by name)
      for (const task of content.tasks ?? []) {
        const sectionId = task.section ? sectionIds.get(task.section) ?? null : null;
        const labelId = task.label ? labelIds.get(task.label) ?? null : null;
        await tx.task.create({
          data: {
            title: task.title,
            description: null,
            status: (task.status as never) ?? 'TODO',
            priority: (task.priority as never) ?? 'MEDIUM',
            sectionId,
            projectId: project.id,
            workspaceId: workspace.id,
            createdById: userId,
            ...(labelId ? { labels: { create: [{ labelId }] } } : {}),
          },
        });
      }

      // 5. Milestones (dueDate anchored to today + dueWeek)
      const anchor = new Date();
      for (const milestone of content.milestones ?? []) {
        await tx.projectMilestone.create({
          data: {
            title: milestone.title,
            dueDate: new Date(anchor.getTime() + milestone.dueWeek * WEEK_MS),
            projectId: project.id,
          },
        });
      }

      // 6. Views
      for (const view of content.views ?? []) {
        await tx.projectView.create({
          data: {
            name: view.name,
            type: view.type as never,
            projectId: project.id,
            createdById: userId,
          },
        });
      }

      // 7. Usage counter
      await tx.projectTemplate.update({
        where: { id: template.id },
        data: { usageCount: { increment: 1 } },
      });
    });

    // Cache invalidation (best-effort, matches project-mutation conventions)
    Promise.all([
      ProjectCache.invalidateWorkspaceProjects(input.workspaceId),
      ProjectCache.invalidateUserProjects(userId),
      WorkspaceCache.invalidateWorkspace(input.workspaceId, workspace.slug),
      AnalyticsCache.invalidateWorkspace(input.workspaceId),
    ]).catch(() => {});
    addBatchInvalidateCacheJob([
      { type: 'workspace', workspaceId: input.workspaceId },
      { type: 'analytics', workspaceId: input.workspaceId },
    ]).catch(() => {});

    return { projectSlug, workspaceSlug: workspace.slug };
  },

  /** Snapshot a project (structure only) as a PRIVATE template for its workspace. */
  async saveAsTemplate(
    req: AuthRequest,
    projectId: string,
    input: { title?: string; visibility?: 'PRIVATE' | 'PUBLIC' },
  ): Promise<{ slug: string; title: string; visibility: TemplateVisibility }> {
    const userId = req.user!.id;
    const project = await assertProjectEditAccess(userId, projectId);

    const [sections, taskLabels, tasks, milestones, views, user] = await Promise.all([
      prisma.projectSection.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { name: true, description: true, color: true, taskStatus: true, wipLimit: true },
      }),
      prisma.taskLabel.findMany({
        where: { task: { projectId } },
        include: { label: { select: { name: true, color: true } } },
      }),
      prisma.task.findMany({
        where: { projectId },
        select: {
          title: true,
          status: true,
          priority: true,
          sectionId: true,
          labels: { select: { label: { select: { name: true } } } },
        },
      }),
      prisma.projectMilestone.findMany({
        where: { projectId },
        select: { title: true, dueDate: true },
      }),
      prisma.projectView.findMany({
        where: { projectId },
        select: { name: true, type: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    const sectionNames = await prisma.projectSection.findMany({
      where: { projectId },
      select: { id: true, name: true },
    });
    const sectionNameById = new Map(sectionNames.map((s) => [s.id, s.name]));

    // Dedupe labels by name.
    const seenLabels = new Set<string>();
    const labels: Array<{ name: string; color: string }> = [];
    for (const tl of taskLabels) {
      if (seenLabels.has(tl.label.name)) continue;
      seenLabels.add(tl.label.name);
      labels.push({ name: tl.label.name, color: tl.label.color });
    }

    const content = createContentSnapshot({
      sections: sections.map((s) => ({
        name: s.name,
        description: s.description,
        color: s.color,
        taskStatus: s.taskStatus,
        wipLimit: s.wipLimit,
      })),
      labels,
      tasks: tasks.map((t) => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        sectionName: t.sectionId ? sectionNameById.get(t.sectionId) ?? null : null,
        labelName: t.labels[0]?.label.name ?? null,
      })),
      milestones: milestones.map((m) => ({ title: m.title, dueDate: m.dueDate })),
      views: views.map((v) => ({ name: v.name, type: v.type })),
    });

    const title = input.title?.trim() || project.name;
    const baseSlug = slugify(title, { lower: true, strict: true }) || 'template';
    const templateSlug = `${baseSlug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const plan = project.workspaceId ? await resolveWorkspacePlan(project.workspaceId) : 'FREE';

    await prisma.projectTemplate.create({
      data: {
        slug: templateSlug,
        title,
        description: '',
        longDescription: null,
        category: 'operations',
        complexity: 'intermediate',
        tier: planToTier(plan),
        icon: '📁',
        color: '#667eea',
        status: 'available',
        // Moderation gate: a "PUBLIC" request becomes PENDING — a Focura
        // admin must approve before the template appears in the gallery.
        visibility: input.visibility === 'PUBLIC' ? 'PENDING' : 'PRIVATE',
        workspaceId: project.workspaceId,
        sourceProjectId: projectId,
        authorId: userId,
        authorName: user?.name ?? null,
        authorRole: 'Workspace',
        tags: [],
        estimatedSetupMinutes: 2,
        content: content as unknown as object,
      },
    });

    return {
      slug: templateSlug,
      title,
      visibility: input.visibility === 'PUBLIC' ? 'PENDING' : 'PRIVATE',
    };
  },

  async update(
    req: AuthRequest,
    slug: string,
    data: Record<string, unknown>,
  ): Promise<{ slug: string; title: string }> {
    const existing = await prisma.projectTemplate.findUnique({ where: { slug } });
    if (!existing) throw new NotFoundError('Template not found');
    assertCanManageTemplate(req, existing);

    const updated = await prisma.projectTemplate.update({
      where: { slug },
      data,
      select: { slug: true, title: true },
    });
    return updated;
  },

  async remove(req: AuthRequest, slug: string): Promise<{ success: boolean }> {
    const existing = await prisma.projectTemplate.findUnique({ where: { slug } });
    if (!existing) throw new NotFoundError('Template not found');
    assertCanManageTemplate(req, existing);

    await prisma.projectTemplate.delete({ where: { slug } });
    return { success: true };
  },

  /**
   * Admin: approve a PENDING community submission → PUBLIC (live in the
   * gallery). Approving an already-public template is a no-op; PRIVATE
   * drafts cannot be approved out from under their workspace.
   */
  async approve(
    slug: string,
  ): Promise<{ slug: string; title: string; visibility: TemplateVisibility }> {
    const existing = await prisma.projectTemplate.findUnique({
      where: { slug },
      select: { slug: true, title: true, visibility: true },
    });
    if (!existing) throw new NotFoundError('Template not found');
    if (existing.visibility === 'PRIVATE') {
      throw new ValidationError('Only pending templates can be approved');
    }

    const updated = await prisma.projectTemplate.update({
      where: { slug },
      data: { visibility: 'PUBLIC' },
      select: { slug: true, title: true, visibility: true },
    });
    return {
      slug: updated.slug,
      title: updated.title,
      visibility: updated.visibility as TemplateVisibility,
    };
  },

  /**
   * Admin: reject a submission (or unpublish a live one) → back to PRIVATE.
   * The template stays available to its workspace but leaves the gallery.
   */
  async reject(
    slug: string,
  ): Promise<{ slug: string; title: string; visibility: TemplateVisibility }> {
    const existing = await prisma.projectTemplate.findUnique({
      where: { slug },
      select: { slug: true, title: true, visibility: true },
    });
    if (!existing) throw new NotFoundError('Template not found');

    const updated = await prisma.projectTemplate.update({
      where: { slug },
      data: { visibility: 'PRIVATE' },
      select: { slug: true, title: true, visibility: true },
    });
    return {
      slug: updated.slug,
      title: updated.title,
      visibility: updated.visibility as TemplateVisibility,
    };
  },

  /**
   * Rate a public template (1–5 stars). One rating per user per template —
   * re-rating replaces the previous stars. Aggregates are recomputed from the
   * TemplateRating table (race-safe and self-healing), so ratingSum/ratingCount
   * always match the actual ratings.
   */
  async rate(
    userId: string,
    slug: string,
    stars: number,
  ): Promise<{ average: number; count: number }> {
    const template = await prisma.projectTemplate.findUnique({
      where: { slug },
      select: { id: true, tier: true, visibility: true, status: true },
    });
    if (!template || template.visibility !== 'PUBLIC' || template.status === 'archived') {
      throw new NotFoundError('Template not found');
    }

    // Tier gate — mirrors the import path and the UI lock: a FREE user must not
    // rate a PRO/BUSINESS template by calling the API directly.
    const callerTier = await resolveUserAccessTier(userId);
    if (!canAccessTier(callerTier, template.tier)) {
      const needs = template.tier === 'BUSINESS' ? 'Business' : 'Pro';
      throw new PlanLimitError(
        `This template requires the ${needs} plan to rate. Upgrade to share your feedback.`,
      );
    }

    const apply = () =>
      prisma.$transaction(async (tx) => {
        await tx.templateRating.upsert({
          where: { templateId_userId: { templateId: template.id, userId } },
          create: { templateId: template.id, userId, stars },
          update: { stars },
        });
        const agg = await tx.templateRating.aggregate({
          where: { templateId: template.id },
          _sum: { stars: true },
          _count: true,
        });
        const ratingSum = agg._sum.stars ?? 0;
        const ratingCount = agg._count;
        await tx.projectTemplate.update({
          where: { id: template.id },
          data: { ratingSum, ratingCount },
        });
        return { ratingSum, ratingCount };
      });

    let result: { ratingSum: number; ratingCount: number };
    try {
      result = await apply();
    } catch (err) {
      // Concurrent first-ratings race on the unique constraint — retry once
      // (the upsert is idempotent, so the retry simply updates the winner's row).
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      result = await apply();
    }

    const average =
      result.ratingCount > 0
        ? Math.round((result.ratingSum / result.ratingCount) * 10) / 10
        : 0;
    return { average, count: result.ratingCount };
  },
};
