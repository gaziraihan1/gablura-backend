import { describe, it, expect } from 'vitest';
import { normalizePage, buildPaginationMeta } from '../../../modules/label/label.utils.js';

describe('normalizePage', () => {
  it('returns default values when no params provided', () => {
    const result = normalizePage();

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.skip).toBe(0);
  });

  it('uses provided page and limit values', () => {
    const result = normalizePage(2, 10);

    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.skip).toBe(10);
  });

  it('handles string inputs by converting to numbers', () => {
    const result = normalizePage('3', '15');

    expect(result.page).toBe(3);
    expect(result.limit).toBe(15);
    expect(result.skip).toBe(30);
  });

  it('clamps page to minimum of 1', () => {
    const result = normalizePage(0, 20);

    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('clamps page to minimum of 1 for negative values', () => {
    const result = normalizePage(-5, 20);

    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('clamps limit to maximum of 100', () => {
    const result = normalizePage(1, 200);

    expect(result.limit).toBe(100);
    expect(result.skip).toBe(0);
  });

  it('handles limit of 0 by using default', () => {
    const result = normalizePage(1, 0);

    expect(result.limit).toBe(20);
    expect(result.skip).toBe(0);
  });

  it('handles invalid string inputs by using defaults', () => {
    const result = normalizePage('invalid', 'also-invalid');

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.skip).toBe(0);
  });

  it('calculates skip correctly for various page values', () => {
    const result1 = normalizePage(1, 10);
    expect(result1.skip).toBe(0);

    const result2 = normalizePage(2, 10);
    expect(result2.skip).toBe(10);

    const result3 = normalizePage(5, 25);
    expect(result3.skip).toBe(100);
  });

  it('handles mixed valid and invalid inputs', () => {
    const result = normalizePage('5', 'invalid');

    expect(result.page).toBe(5);
    expect(result.limit).toBe(20);
    expect(result.skip).toBe(80);
  });
});

describe('buildPaginationMeta', () => {
  it('returns correct pagination metadata', () => {
    const result = buildPaginationMeta(100, { page: 1, limit: 20 });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(100);
    expect(result.totalPages).toBe(5);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(false);
  });

  it('returns hasPrevPage false for page 1', () => {
    const result = buildPaginationMeta(100, { page: 1, limit: 20 });

    expect(result.hasPrevPage).toBe(false);
  });

  it('returns hasPrevPage true for page > 1', () => {
    const result = buildPaginationMeta(100, { page: 2, limit: 20 });

    expect(result.hasPrevPage).toBe(true);
  });

  it('returns hasNextPage true when not on last page', () => {
    const result = buildPaginationMeta(100, { page: 3, limit: 20 });

    expect(result.hasNextPage).toBe(true);
  });

  it('returns hasNextPage false when on last page', () => {
    const result = buildPaginationMeta(100, { page: 5, limit: 20 });

    expect(result.hasNextPage).toBe(false);
  });

  it('returns hasNextPage false when total equals page * limit', () => {
    const result = buildPaginationMeta(40, { page: 2, limit: 20 });

    expect(result.hasNextPage).toBe(false);
  });

  it('handles total of 0', () => {
    const result = buildPaginationMeta(0, { page: 1, limit: 20 });

    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
  });

  it('handles total less than limit', () => {
    const result = buildPaginationMeta(5, { page: 1, limit: 20 });

    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
  });

  it('calculates totalPages correctly for exact division', () => {
    const result = buildPaginationMeta(60, { page: 1, limit: 20 });

    expect(result.totalPages).toBe(3);
  });

  it('calculates totalPages correctly for non-exact division', () => {
    const result = buildPaginationMeta(55, { page: 1, limit: 20 });

    expect(result.totalPages).toBe(3);
  });

  it('returns totalPages of 1 when total is 0', () => {
    const result = buildPaginationMeta(0, { page: 1, limit: 20 });

    expect(result.totalPages).toBe(1);
  });

  it('handles single item total', () => {
    const result = buildPaginationMeta(1, { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
  });

  it('handles large total values', () => {
    const result = buildPaginationMeta(1000, { page: 50, limit: 20 });

    expect(result.total).toBe(1000);
    expect(result.totalPages).toBe(50);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(true);
  });

  it('handles limit of 1', () => {
    const result = buildPaginationMeta(10, { page: 5, limit: 1 });

    expect(result.total).toBe(10);
    expect(result.totalPages).toBe(10);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(true);
  });

  it('handles limit of 100 (maximum)', () => {
    const result = buildPaginationMeta(500, { page: 3, limit: 100 });

    expect(result.total).toBe(500);
    expect(result.totalPages).toBe(5);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(true);
  });
});
