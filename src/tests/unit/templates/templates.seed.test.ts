/**
 * src/tests/unit/templates/templates.seed.test.ts
 *
 * Validates the official catalog data itself — the distribution contract
 * (2 FREE / 9 PRO / 1 BUSINESS), slug uniqueness, and content invariants the
 * import endpoint relies on (distinct section statuses, valid enums).
 */
import { describe, it, expect } from 'vitest';
import { OFFICIAL_TEMPLATES } from '../../../modules/templates/templates.data.js';

const VALID_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED'];
const VALID_PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

describe('OFFICIAL_TEMPLATES', () => {
  it('has exactly 12 templates', () => {
    expect(OFFICIAL_TEMPLATES).toHaveLength(12);
  });

  it('follows the tier distribution: 2 FREE / 9 PRO / 1 BUSINESS', () => {
    const byTier = OFFICIAL_TEMPLATES.reduce<Record<string, number>>((acc, t) => {
      acc[t.tier] = (acc[t.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(byTier).toEqual({ FREE: 2, PRO: 9, BUSINESS: 1 });
  });

  it('has unique slugs and non-empty titles', () => {
    const slugs = OFFICIAL_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of OFFICIAL_TEMPLATES) {
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('covers the expected categories', () => {
    const categories = new Set(OFFICIAL_TEMPLATES.map((t) => t.category));
    expect(categories).toEqual(
      expect.objectContaining(new Set(['engineering', 'product', 'marketing', 'design', 'operations', 'hr', 'startup', 'personal'])),
    );
  });

  it('keeps section statuses distinct per template (unique board constraint)', () => {
    for (const t of OFFICIAL_TEMPLATES) {
      const statuses = t.content.sections
        .map((s) => s.taskStatus)
        .filter((s): s is string => Boolean(s));
      expect(new Set(statuses).size, `${t.slug} has duplicate section statuses`).toBe(statuses.length);
    }
  });

  it('uses only valid task statuses and priorities', () => {
    for (const t of OFFICIAL_TEMPLATES) {
      for (const task of t.content.tasks) {
        expect(VALID_STATUSES, `${t.slug}: ${task.title}`).toContain(task.status);
        expect(VALID_PRIORITIES, `${t.slug}: ${task.title}`).toContain(task.priority);
      }
    }
  });

  it('references existing sections and labels from tasks', () => {
    for (const t of OFFICIAL_TEMPLATES) {
      const sectionNames = new Set(t.content.sections.map((s) => s.name));
      const labelNames = new Set(t.content.labels.map((l) => l.name));
      for (const task of t.content.tasks) {
        if (task.section) {
          expect(sectionNames.has(task.section), `${t.slug}: missing section ${task.section}`).toBe(true);
        }
        if (task.label) {
          expect(labelNames.has(task.label), `${t.slug}: missing label ${task.label}`).toBe(true);
        }
      }
    }
  });

  it('uses valid view types and unique view names per template', () => {
    const valid = new Set(['KANBAN', 'LIST', 'CALENDAR', 'TIMELINE']);
    for (const t of OFFICIAL_TEMPLATES) {
      const names = new Set<string>();
      for (const v of t.content.views) {
        expect(valid.has(v.type), `${t.slug}: invalid view type ${v.type}`).toBe(true);
        expect(names.has(v.name), `${t.slug}: duplicate view ${v.name}`).toBe(false);
        names.add(v.name);
      }
    }
  });
});
