import { describe, it, expect } from 'vitest';
import { PROFILE_UPDATE_LIMITS } from '../../../utils/plans.js';

describe('Plans Config', () => {
  it('should have correct update limits for different tiers', () => {
    expect(PROFILE_UPDATE_LIMITS.FREE).toBe(24 * 60 * 60 * 1000);
    expect(PROFILE_UPDATE_LIMITS.PRO).toBe(6 * 60 * 60 * 1000);
    expect(PROFILE_UPDATE_LIMITS.BUSINESS).toBe(30 * 60 * 1000);
  });
});
