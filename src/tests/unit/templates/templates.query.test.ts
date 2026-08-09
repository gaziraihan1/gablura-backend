/**
 * src/tests/unit/templates/templates.query.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateQuery } from '../../../modules/templates/templates.query.js';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../errors/index.js';

const mockAssertWorkspaceMembership = vi.fn();

vi.mock('../../../modules/templates/templates.access.js', () => ({
  assertWorkspaceMembership: (...args: unknown[]) => mockAssertWorkspaceMembership(...args),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    projectTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    workspace: { findMany: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
  },
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'tpl1',
  slug: 'engineering-sprint',
  title: 'Agile Sprint Board',
  description: 'A sprint board',
  longDescription: null,
  category: 'engineering',
  complexity: 'starter',
  tier: 'PRO',
  icon: '⚙️',
  color: '#3b82f6',
  tags: ['agile'],
  usageCount: 5,
  ratingSum: 0,
  ratingCount: 0,
  estimatedSetupMinutes: 3,
  status: 'available',
  featured: false,
  visibility: 'PUBLIC',
  authorName: 'Focura Team',
  authorRole: 'Official',
  content: { sections: [], labels: [], tasks: [], milestones: [], views: [] },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertWorkspaceMembership.mockResolvedValue(undefined);
  vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([] as never);
});

describe('resolveUserAccessTier', () => {
  it('returns FREE for anonymous users', async () => {
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);
    await expect(TemplateQuery.getCatalog(undefined, {})).resolves.toMatchObject({
      access: { tier: 'FREE' },
    });
  });

  it('returns the best tier across owned workspaces', async () => {
    vi.mocked(prisma.workspace.findMany).mockResolvedValue([
      { plan: 'FREE' },
      { plan: 'PRO' },
    ] as never);
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);

    await expect(TemplateQuery.getCatalog('u1', {})).resolves.toMatchObject({
      access: { tier: 'PRO' },
    });
  });

  it('treats BUSINESS and ENTERPRISE as the top tier', async () => {
    vi.mocked(prisma.workspace.findMany).mockResolvedValue([
      { plan: 'BUSINESS' },
      { plan: 'ENTERPRISE' },
    ] as never);
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);

    await expect(TemplateQuery.getCatalog('u1', {})).resolves.toMatchObject({
      access: { tier: 'BUSINESS' },
    });
  });

  it('considers paid workspaces the user belongs to', async () => {
    vi.mocked(prisma.workspace.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
      { workspace: { plan: 'BUSINESS' } },
    ] as never);
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);

    await expect(TemplateQuery.getCatalog('u1', {})).resolves.toMatchObject({
      access: { tier: 'BUSINESS' },
    });
  });
});

describe('TemplateQuery.getCatalog', () => {
  it('queries only public, non-archived templates', async () => {
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([row()] as never);

    await TemplateQuery.getCatalog(undefined, {});

    expect(prisma.projectTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibility: 'PUBLIC',
          status: { in: ['available', 'coming_soon'] },
        }),
      }),
    );
  });

  it('filters to featured templates when requested', async () => {
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);

    await TemplateQuery.getCatalog(undefined, { featured: true });

    const args = vi.mocked(prisma.projectTemplate.findMany).mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown>;
    expect(where.featured).toBe(true);
  });

  it('applies category, tier and search filters', async () => {
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([] as never);

    await TemplateQuery.getCatalog('u1', {
      category: 'engineering',
      tier: 'PRO',
      search: 'sprint',
    });

    const args = vi.mocked(prisma.projectTemplate.findMany).mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown>;
    expect(where.category).toBe('engineering');
    expect(where.tier).toBe('PRO');
    expect(where.OR).toBeDefined();
  });
});

describe('TemplateQuery.getBySlug', () => {
  it('returns the template detail', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(row() as never);

    const detail = await TemplateQuery.getBySlug('engineering-sprint');

    expect(detail.slug).toBe('engineering-sprint');
    expect(detail.author).toEqual({ name: 'Focura Team', role: 'Official' });
  });

  it('maps rating aggregates and the featured flag onto the item', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      row({ ratingSum: 48, ratingCount: 10, featured: true }) as never,
    );

    const detail = await TemplateQuery.getBySlug('engineering-sprint');

    expect(detail.rating).toEqual({ average: 4.8, count: 10 });
    expect(detail.featured).toBe(true);
  });

  it('throws NotFoundError when missing or archived', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(null);
    await expect(TemplateQuery.getBySlug('missing')).rejects.toThrow(NotFoundError);

    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      row({ status: 'archived' }) as never,
    );
    await expect(TemplateQuery.getBySlug('archived-one')).rejects.toThrow(NotFoundError);
  });
});

describe('TemplateQuery.getWorkspacePrivate', () => {
  it('requires membership and returns only PRIVATE templates', async () => {
    vi.mocked(prisma.projectTemplate.findMany).mockResolvedValue([row()] as never);

    await TemplateQuery.getWorkspacePrivate('u1', 'ws1');

    expect(mockAssertWorkspaceMembership).toHaveBeenCalledWith('u1', 'ws1');
    expect(prisma.projectTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws1', visibility: 'PRIVATE' },
      }),
    );
  });
});
