
import { describe, expect, it } from 'vitest';
import {
  paginationSchema,
  updateWorkspaceLimitsSchema,
  banUserSchema,
  deleteWorkspaceSchema,
} from '../../../admin/admin.validation.js';

describe('paginationSchema', () => {
  it('applies defaults when called with an empty object', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('coerces string numbers', () => {
    const result = paginationSchema.parse({ page: '3', pageSize: '10' });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it('rejects page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects pageSize > 100', () => {
    expect(() => paginationSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('accepts optional search and workspaceId', () => {
    const result = paginationSchema.parse({ search: 'acme', workspaceId: 'ws-123' });
    expect(result.search).toBe('acme');
    expect(result.workspaceId).toBe('ws-123');
  });
});

describe('updateWorkspaceLimitsSchema', () => {
  it('parses valid input', () => {
    const result = updateWorkspaceLimitsSchema.parse({
      plan: 'PRO',
      maxMembers: 25,
      maxStorage: 5000,
    });
    expect(result.plan).toBe('PRO');
  });

  it('accepts -1 for unlimited fields', () => {
    const result = updateWorkspaceLimitsSchema.parse({
      plan: 'FREE',
      maxMembers: -1,
      maxStorage: -1,
    });
    expect(result.maxMembers).toBe(-1);
    expect(result.maxStorage).toBe(-1);
  });

  it('rejects maxMembers of 0', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'PRO', maxMembers: 0, maxStorage: 100 })
    ).toThrow('maxMembers');
  });

  it('rejects maxStorage of 0', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'PRO', maxMembers: 5, maxStorage: 0 })
    ).toThrow('maxStorage');
  });

  it('rejects invalid plan enum', () => {
    expect(() =>
      updateWorkspaceLimitsSchema.parse({ plan: 'ENTERPRISE', maxMembers: 5, maxStorages: 100 })
    ).toThrow();
  });
});

describe('banUserSchema', () => {
  it('parses a valid reason', () => {
    const result = banUserSchema.parse({ reason: 'Violates ToS' });
    expect(result.reason).toBe('Violates ToS');
  });

  it('rejects an empty reason', () => {
    expect(() => banUserSchema.parse({ reason: '' })).toThrow('Reason is required');
  });

  it('rejects a reason longer than 500 chars', () => {
    expect(() => banUserSchema.parse({ reason: 'a'.repeat(501) })).toThrow();
  });
});

describe('deleteWorkspaceSchema', () => {
  it('defaults hardDelete to false', () => {
    const result = deleteWorkspaceSchema.parse({});
    expect(result.hardDelete).toBe(false);
  });

  it('accepts hardDelete: true', () => {
    const result = deleteWorkspaceSchema.parse({ hardDelete: true });
    expect(result.hardDelete).toBe(true);
  });

  it('accepts an optional reason up to 500 chars', () => {
    const result = deleteWorkspaceSchema.parse({ reason: 'Policy violation' });
    expect(result.reason).toBe('Policy violation');
  });

  it('rejects a reason over 500 chars', () => {
    expect(() =>
      deleteWorkspaceSchema.parse({ reason: 'x'.repeat(501) })
    ).toThrow();
  });
});