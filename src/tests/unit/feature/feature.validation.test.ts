import { describe, expect, it } from 'vitest';
import {
  createFeatureRequestSchema,
  updateFeatureStatusSchema,
  castVoteSchema,
  listFeaturesSchema,
} from '../../../modules/feature/feature.validation.js';

describe('createFeatureRequestSchema', () => {
  it('parses valid input', () => {
    const input = {
      title: 'Support markdown in comments',
      description: 'We need to format our comments using rich markdown styling.',
    };
    const result = createFeatureRequestSchema.parse(input);
    expect(result.title).toBe(input.title);
    expect(result.description).toBe(input.description);
  });

  it('rejects an empty title', () => {
    expect(() =>
      createFeatureRequestSchema.parse({
        title: '',
        description: 'Valid description',
      })
    ).toThrow();
  });

  it('rejects a title exceeding 150 characters', () => {
    expect(() =>
      createFeatureRequestSchema.parse({
        title: 'a'.repeat(151),
        description: 'Valid description',
      })
    ).toThrow();
  });

  it('rejects an empty description', () => {
    expect(() =>
      createFeatureRequestSchema.parse({
        title: 'Valid title',
        description: '',
      })
    ).toThrow();
  });

  it('rejects a description exceeding 2000 characters', () => {
    expect(() =>
      createFeatureRequestSchema.parse({
        title: 'Valid title',
        description: 'a'.repeat(2001),
      })
    ).toThrow();
  });
});

describe('updateFeatureStatusSchema', () => {
  it('parses valid input with optional adminNote', () => {
    const input = {
      status: 'APPROVED',
      adminNote: 'This is planned for next sprint.',
    };
    const result = updateFeatureStatusSchema.parse(input);
    expect(result.status).toBe('APPROVED');
    expect(result.adminNote).toBe(input.adminNote);
  });

  it('parses valid status without adminNote', () => {
    const result = updateFeatureStatusSchema.parse({ status: 'PLANNED' });
    expect(result.status).toBe('PLANNED');
    expect(result.adminNote).toBeUndefined();
  });

  it('rejects invalid status', () => {
    expect(() =>
      updateFeatureStatusSchema.parse({ status: 'SOMETHING_ELSE' })
    ).toThrow();
  });

  it('rejects adminNote exceeding 500 characters', () => {
    expect(() =>
      updateFeatureStatusSchema.parse({
        status: 'REJECTED',
        adminNote: 'a'.repeat(501),
      })
    ).toThrow();
  });
});

describe('castVoteSchema', () => {
  it('parses UP and DOWN', () => {
    expect(castVoteSchema.parse({ type: 'UP' }).type).toBe('UP');
    expect(castVoteSchema.parse({ type: 'DOWN' }).type).toBe('DOWN');
  });

  it('rejects invalid vote type', () => {
    expect(() => castVoteSchema.parse({ type: 'SIDEWAYS' })).toThrow();
  });
});

describe('listFeaturesSchema', () => {
  it('applies defaults when empty', () => {
    const result = listFeaturesSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.status).toBeUndefined();
    expect(result.search).toBeUndefined();
  });

  it('coerces and validates page/pageSize', () => {
    const result = listFeaturesSchema.parse({
      page: '2',
      pageSize: '30',
      status: 'APPROVED',
      search: 'markdown',
    });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(30);
    expect(result.status).toBe('APPROVED');
    expect(result.search).toBe('markdown');
  });

  it('rejects page < 1', () => {
    expect(() => listFeaturesSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects pageSize > 50', () => {
    expect(() => listFeaturesSchema.parse({ pageSize: 51 })).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => listFeaturesSchema.parse({ status: 'INVALID_STATUS' })).toThrow();
  });
});
