
import { prisma } from '../../lib/prisma.js';
import type { GoalCheckpoint, CreateGoalCheckpointInput } from './calendar.types.js';
import { CalendarCache } from '../../lib/redis/cache.client.js';

export const CalendarMutation = {
  async createGoalCheckpoint(data: CreateGoalCheckpointInput): Promise<GoalCheckpoint> {
    const goal = await prisma.goalCheckpoint.create({
      data: {
        userId:      data.userId,
        workspaceId: data.workspaceId,
        title:       data.title,
        type:        data.type,
        targetDate:  data.targetDate,
      },
    });

    // Invalidate goal checkpoints cache
    CalendarCache.invalidateGoalCheckpoints(data.userId, data.workspaceId).catch(() => {});

    return goal;
  },

  async initializeUserSettings(userId: string): Promise<void> {
    await Promise.all([
      prisma.userCapacity.upsert({
        where:  { userId },
        update: {},
        create: {
          userId,
          weeklyHours:         40,
          dailyCapacityHours:  8,
          deepWorkHours:       4,
        },
      }),

      prisma.userWorkSchedule.upsert({
        where:  { userId },
        update: {},
        create: {
          userId,
          workDays:       ['MON', 'TUE', 'WED', 'THU', 'FRI'],
          workStartHour:  9,
          workEndHour:    17,
        },
      }),
    ]);

    // Invalidate all calendar cache for user since capacity/schedule affects calculations
    CalendarCache.invalidateUserCalendar(userId).catch(() => {});
  },
};