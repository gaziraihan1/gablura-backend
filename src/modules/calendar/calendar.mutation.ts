
import { prisma } from '../../lib/prisma.js';
import type {
  GoalCheckpoint,
  CreateGoalCheckpointInput,
  EnergyLevel,
  UserCapacityData,
  UserWorkScheduleData,
} from './calendar.types.js';
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

    CalendarCache.invalidateUserCalendar(userId).catch(() => {});
  },

  async updateCapacity(userId: string, data: Partial<UserCapacityData>): Promise<UserCapacityData> {
    const capacity = await prisma.userCapacity.upsert({
      where:  { userId },
      update: { ...data },
      create: {
        userId,
        weeklyHours:         data.weeklyHours ?? 40,
        dailyCapacityHours:  data.dailyCapacityHours ?? 8,
        deepWorkHours:       data.deepWorkHours ?? 4,
      },
    });

    await Promise.all([
      CalendarCache.invalidateCapacity(userId).catch(() => {}),
      CalendarCache.invalidateUserCalendar(userId).catch(() => {}),
    ]);
    return {
      weeklyHours:        capacity.weeklyHours,
      dailyCapacityHours: capacity.dailyCapacityHours,
      deepWorkHours:      capacity.deepWorkHours,
    };
  },

  async updateSchedule(userId: string, data: Partial<UserWorkScheduleData>): Promise<UserWorkScheduleData> {
    const schedule = await prisma.userWorkSchedule.upsert({
      where:  { userId },
      update: { ...data },
      create: {
        userId,
        workDays:      (data.workDays as any) ?? ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        workStartHour: data.workStartHour ?? 9,
        workEndHour:   data.workEndHour ?? 17,
        timezone:      data.timezone,
      },
    });

    await Promise.all([
      CalendarCache.invalidateSchedule(userId).catch(() => {}),
      CalendarCache.invalidateUserCalendar(userId).catch(() => {}),
    ]);
    return {
      workDays:      schedule.workDays as string[],
      workStartHour: schedule.workStartHour,
      workEndHour:   schedule.workEndHour,
      timezone:      schedule.timezone ?? undefined,
    };
  },

  async logEnergy(userId: string, date: Date, energyLevel: number, note?: string): Promise<EnergyLevel> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const entry = await prisma.energyLevel.upsert({
      where:  { userId_date: { userId, date: dayStart } },
      update: { energyLevel, note },
      create: { userId, date: dayStart, energyLevel, note },
    });

    CalendarCache.invalidateEnergy(userId).catch(() => {});
    return entry;
  },
};