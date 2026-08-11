import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS } from '../../../modules/billing/plans.config.js';

describe('billing.plans.config', () => {
  describe('PLAN_LIMITS', () => {
    it('should have FREE, PRO, BUSINESS, and ENTERPRISE plans', () => {
      expect(PLAN_LIMITS).toHaveProperty('FREE');
      expect(PLAN_LIMITS).toHaveProperty('PRO');
      expect(PLAN_LIMITS).toHaveProperty('BUSINESS');
      expect(PLAN_LIMITS).toHaveProperty('ENTERPRISE');
    });

    it('FREE should have correct limits', () => {
      const free = PLAN_LIMITS.FREE;
      expect(free.maxWorkspacesOwned).toBe(1);
      expect(free.maxMembersPerWs).toBe(5);
      expect(free.maxStorageMb).toBe(1024);
      expect(free.maxFileSizeMb).toBe(5);
      expect(free.analyticsAccess).toBe(false);
      expect(free.prioritySupport).toBe(false);
      expect(free.apiAccess).toBe(false);
      expect(free.businessOnlyAccess).toBe(false);
    });

    it('PRO should have correct limits', () => {
      const pro = PLAN_LIMITS.PRO;
      expect(pro.maxWorkspacesOwned).toBe(3);
      expect(pro.maxMembersPerWs).toBe(25);
      expect(pro.maxStorageMb).toBe(10240);
      expect(pro.maxFileSizeMb).toBe(25);
      expect(pro.analyticsAccess).toBe(true);
      expect(pro.prioritySupport).toBe(false);
      expect(pro.apiAccess).toBe(false);
      expect(pro.businessOnlyAccess).toBe(false);
    });

    it('BUSINESS should have unlimited members and analytics', () => {
      const biz = PLAN_LIMITS.BUSINESS;
      expect(biz.maxWorkspacesOwned).toBe(-1);
      expect(biz.maxMembersPerWs).toBe(-1);
      expect(biz.analyticsAccess).toBe(true);
      expect(biz.prioritySupport).toBe(true);
      expect(biz.apiAccess).toBe(true);
    });

    it('PRO should have limited meetings per month', () => {
      expect(PLAN_LIMITS.PRO.maxMeetingsPerMo).toBe(-1);
      expect(PLAN_LIMITS.FREE.maxMeetingsPerMo).toBe(10);
    });

    it('ENTERPRISE should have top-tier allowances with unlimited storage', () => {
      const ent = PLAN_LIMITS.ENTERPRISE;
      expect(ent.maxWorkspacesOwned).toBe(-1);
      expect(ent.maxMembersPerWs).toBe(-1);
      expect(ent.maxStorageMb).toBe(-1);
      expect(ent.analyticsAccess).toBe(true);
      expect(ent.businessOnlyAccess).toBe(true);
      expect(ent.prioritySupport).toBe(true);
      expect(ent.apiAccess).toBe(true);
    });
  });
});
