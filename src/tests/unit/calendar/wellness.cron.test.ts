import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../../../modules/calendar/wellness.service.js', () => ({
  WellnessService: { generateRecommendations: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

import cron from 'node-cron';
import { initWellnessCrons } from '../../../modules/calendar/wellness.cron.js';
import { WellnessService } from '../../../modules/calendar/wellness.service.js';
import { prisma } from '../../../lib/prisma.js';

describe('wellness.cron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should schedule the wellness cron at 0 6 * * *', () => {
    initWellnessCrons();
    expect(cron.schedule).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));
  });

  it('should call generateRecommendations for each user when cron fires', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValueOnce([]);
    vi.mocked(WellnessService.generateRecommendations).mockResolvedValue(undefined as any);

    initWellnessCrons();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
    await callback();

    expect(WellnessService.generateRecommendations).toHaveBeenCalledTimes(2);
    expect(WellnessService.generateRecommendations).toHaveBeenCalledWith('u1');
    expect(WellnessService.generateRecommendations).toHaveBeenCalledWith('u2');
  });

  it('should not throw when generateRecommendations fails', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: 'u1' }])
      .mockResolvedValueOnce([]);
    vi.mocked(WellnessService.generateRecommendations).mockRejectedValue(new Error('DB error'));

    initWellnessCrons();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;

    await expect(callback()).resolves.not.toThrow();
  });

  it('should paginate through users in batches', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: `u${i}` })))
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ id: `u${i + 50}` })))
      .mockResolvedValueOnce([]);
    vi.mocked(WellnessService.generateRecommendations).mockResolvedValue(undefined as any);

    initWellnessCrons();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
    await callback();

    expect(WellnessService.generateRecommendations).toHaveBeenCalledTimes(60);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });
});
