import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../../../modules/calendar/calendar.insights.js', () => ({
  CalendarInsightsService: { calculateBurnoutRisk: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

import cron from 'node-cron';
import { initBurnoutSignalCron } from '../../../modules/calendar/burnoutSignal.cron.js';
import { CalendarInsightsService } from '../../../modules/calendar/calendar.insights.js';
import { prisma } from '../../../lib/prisma.js';

describe('burnoutSignal.cron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should schedule the burnout cron weekly on Monday at 7:00', () => {
    initBurnoutSignalCron();
    expect(cron.schedule).toHaveBeenCalledWith('0 7 * * 1', expect.any(Function));
  });

  it('should call calculateBurnoutRisk for each user when cron fires', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }] as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(CalendarInsightsService.calculateBurnoutRisk).mockResolvedValue({} as any);

    initBurnoutSignalCron();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as (...args: any[]) => Promise<void>;
    await callback();

    expect(CalendarInsightsService.calculateBurnoutRisk).toHaveBeenCalledTimes(2);
    expect(CalendarInsightsService.calculateBurnoutRisk).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(CalendarInsightsService.calculateBurnoutRisk).toHaveBeenCalledWith('u2', expect.any(Date));
  });

  it('should not throw when calculateBurnoutRisk fails', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: 'u1' }] as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(CalendarInsightsService.calculateBurnoutRisk).mockRejectedValue(new Error('DB error'));

    initBurnoutSignalCron();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as (...args: any[]) => Promise<void>;

    await expect(callback()).resolves.not.toThrow();
  });

  it('should paginate through users in batches', async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: `u${i}` })) as any)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ id: `u${i + 50}` })) as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(CalendarInsightsService.calculateBurnoutRisk).mockResolvedValue({} as any);

    initBurnoutSignalCron();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as (...args: any[]) => Promise<void>;
    await callback();

    expect(CalendarInsightsService.calculateBurnoutRisk).toHaveBeenCalledTimes(60);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });
});
