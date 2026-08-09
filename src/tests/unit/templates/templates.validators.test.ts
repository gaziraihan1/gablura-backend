/**
 * src/tests/unit/templates/templates.validators.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  listCatalogQuerySchema,
  useTemplateSchema,
  saveAsTemplateSchema,
  updateTemplateSchema,
  privateTemplatesQuerySchema,
  rateTemplateSchema,
} from '../../../modules/templates/templates.validators.js';

describe('listCatalogQuerySchema', () => {
  it('accepts empty query', () => {
    const parsed = listCatalogQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it('accepts valid filters', () => {
    const parsed = listCatalogQuerySchema.safeParse({
      category: 'engineering',
      search: 'sprint',
      tier: 'PRO',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid tier', () => {
    const parsed = listCatalogQuerySchema.safeParse({ tier: 'ENTERPRISE' });
    expect(parsed.success).toBe(false);
  });

  it('accepts the featured flag', () => {
    expect(listCatalogQuerySchema.safeParse({ featured: 'true' }).success).toBe(true);
    expect(listCatalogQuerySchema.safeParse({ featured: 'false' }).success).toBe(true);
    expect(listCatalogQuerySchema.safeParse({ featured: 'yes' }).success).toBe(false);
  });
});

describe('useTemplateSchema', () => {
  it('requires workspaceId', () => {
    expect(useTemplateSchema.safeParse({}).success).toBe(false);
    expect(useTemplateSchema.safeParse({ workspaceId: '' }).success).toBe(false);
    expect(useTemplateSchema.safeParse({ workspaceId: 'ws1' }).success).toBe(true);
  });

  it('accepts an optional projectName', () => {
    const parsed = useTemplateSchema.safeParse({ workspaceId: 'ws1', projectName: 'My Project' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.projectName).toBe('My Project');
  });
});

describe('saveAsTemplateSchema', () => {
  it('accepts empty body (defaults applied server-side)', () => {
    expect(saveAsTemplateSchema.safeParse({}).success).toBe(true);
  });

  it('accepts title + visibility', () => {
    const parsed = saveAsTemplateSchema.safeParse({
      title: 'My Template',
      visibility: 'PRIVATE',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid visibility', () => {
    expect(saveAsTemplateSchema.safeParse({ visibility: 'SECRET' }).success).toBe(false);
  });
});

describe('updateTemplateSchema', () => {
  it('accepts a partial update', () => {
    const parsed = updateTemplateSchema.safeParse({
      title: 'Renamed',
      tier: 'PRO',
      tags: ['a', 'b'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid complexity or status', () => {
    expect(updateTemplateSchema.safeParse({ complexity: 'mega' }).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('privateTemplatesQuerySchema', () => {
  it('requires workspaceId', () => {
    expect(privateTemplatesQuerySchema.safeParse({}).success).toBe(false);
    expect(privateTemplatesQuerySchema.safeParse({ workspaceId: 'ws1' }).success).toBe(true);
  });
});

describe('rateTemplateSchema', () => {
  it('accepts stars between 1 and 5', () => {
    for (const stars of [1, 3, 5]) {
      expect(rateTemplateSchema.safeParse({ stars }).success).toBe(true);
    }
  });

  it('rejects out-of-range, fractional and missing stars', () => {
    expect(rateTemplateSchema.safeParse({ stars: 0 }).success).toBe(false);
    expect(rateTemplateSchema.safeParse({ stars: 6 }).success).toBe(false);
    expect(rateTemplateSchema.safeParse({ stars: 4.5 }).success).toBe(false);
    expect(rateTemplateSchema.safeParse({ stars: '5' }).success).toBe(false);
    expect(rateTemplateSchema.safeParse({}).success).toBe(false);
  });
});

describe('updateTemplateSchema featured', () => {
  it('accepts a boolean featured flag', () => {
    expect(updateTemplateSchema.safeParse({ featured: true }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ featured: false }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ featured: 'yes' }).success).toBe(false);
  });
});
