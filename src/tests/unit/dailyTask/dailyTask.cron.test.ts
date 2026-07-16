import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.mutation.js', () => ({
  DailyTaskMutation: {
    clearExpiredDailyTasks: vi.fn(),
  },
}));

import cron from 'node-cron';
import { initDailyTaskCrons } from '../../../modules/dailyTask/dailyTask.cron.js';
import { DailyTaskMutation } from '../../../modules/dailyTask/dailyTask.mutation.js';

describe('DailyTask Cron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should schedule the daily task cleanup cron', () => {
    initDailyTaskCrons();

    expect(cron.schedule).toHaveBeenCalledWith(
      '1 0 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: expect.any(String) }),
    );
  });

  it('should call clearExpiredDailyTasks when cron fires', async () => {
    vi.mocked(DailyTaskMutation.clearExpiredDailyTasks).mockResolvedValue({ deletedCount: 5 });

    initDailyTaskCrons();

    // Get the callback that was passed to cron.schedule
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
    await callback();

    expect(DailyTaskMutation.clearExpiredDailyTasks).toHaveBeenCalled();
  });

  it('should not throw when clearExpiredDailyTasks fails', async () => {
    vi.mocked(DailyTaskMutation.clearExpiredDailyTasks).mockRejectedValue(new Error('DB error'));

    initDailyTaskCrons();

    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
    await expect(callback()).resolves.not.toThrow();
  });
});
