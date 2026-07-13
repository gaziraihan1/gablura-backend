import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { CalendarAggregation }     from './calendar.aggregation.js';
import { CalendarInsightsService } from './calendar.insights.js';
import { CalendarQuery }           from './calendar.query.js';
import { CalendarMutation }        from './calendar.mutation.js';
import { WellnessService }         from './wellness.service.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  calendarRangeSchema,
  createGoalCheckpointSchema,
  recalculateSchema,
  updateCapacitySchema,
  updateScheduleSchema,
  logEnergySchema,
  energyHistorySchema,
} from './calendar.validators.js';

export const getCalendarAggregates = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = calendarRangeSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const aggregates = await CalendarAggregation.getOrComputeAggregates({
    userId: req.user!.id,
    ...parsed.data,
  });

  res.json({ success: true, data: aggregates });
});

export const getCalendarInsights = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = calendarRangeSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { workspaceId, startDate, endDate } = parsed.data;
  const insights = await CalendarInsightsService.getInsights(
    req.user!.id, workspaceId, startDate, endDate,
  );

  res.json({ success: true, data: insights });
});

export const getSystemEvents = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = calendarRangeSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { workspaceId, startDate, endDate } = parsed.data;
  const events = await CalendarQuery.getSystemEvents(
    req.user!.id, workspaceId, startDate, endDate,
  );

  res.json({ success: true, data: events });
});

export const getGoalCheckpoints = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = calendarRangeSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { workspaceId, startDate, endDate } = parsed.data;
  const goals = await CalendarQuery.getGoalCheckpoints(
    req.user!.id, workspaceId, startDate, endDate,
  );

  res.json({ success: true, data: goals });
});

export const createGoalCheckpoint = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createGoalCheckpointSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const goal = await CalendarMutation.createGoalCheckpoint({
    userId: req.user!.id,
    ...parsed.data,
  });

  res.status(201).json({ success: true, data: goal, message: 'Goal checkpoint created successfully' });
});

export const recalculateAggregate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = recalculateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { workspaceId, date } = parsed.data;
  await CalendarAggregation.recalculateDay(req.user!.id, workspaceId, date);

  res.json({ success: true, message: 'Aggregate recalculated successfully' });
});

export const initializeUserSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  await CalendarMutation.initializeUserSettings(req.user!.id);
  res.json({ success: true, message: 'User calendar settings initialized successfully' });
});

export const getCapacity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const capacity = await CalendarQuery.getUserCapacity(req.user!.id);
  res.json({ success: true, data: capacity });
});

export const updateCapacity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateCapacitySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const capacity = await CalendarMutation.updateCapacity(req.user!.id, parsed.data);
  res.json({ success: true, data: capacity, message: 'Capacity settings updated successfully' });
});

export const getSchedule = asyncHandler(async (req: AuthRequest, res: Response) => {
  const schedule = await CalendarQuery.getUserSchedule(req.user!.id);
  res.json({ success: true, data: schedule });
});

export const updateSchedule = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateScheduleSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const schedule = await CalendarMutation.updateSchedule(req.user!.id, parsed.data);
  res.json({ success: true, data: schedule, message: 'Work schedule updated successfully' });
});

export const logEnergy = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = logEnergySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { date, energyLevel, note } = parsed.data;
  const entry = await CalendarMutation.logEnergy(req.user!.id, date, energyLevel, note);
  res.status(201).json({ success: true, data: entry, message: 'Energy level logged successfully' });
});

export const getEnergyLevel = asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  if (!dateStr) throw new ValidationError('Date query parameter is required');

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new ValidationError('Invalid date format');

  const entry = await CalendarQuery.getEnergyLevel(req.user!.id, date);
  res.json({ success: true, data: entry });
});

export const getEnergyHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = energyHistorySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { startDate, endDate, page, limit } = parsed.data;
  const result = await CalendarQuery.getEnergyHistory(req.user!.id, startDate, endDate, page, limit);
  res.json({ success: true, data: result.data, pagination: result.pagination });
});

export const getBurnoutTrends = asyncHandler(async (req: AuthRequest, res: Response) => {
  const rawWeeks = parseInt(req.query.weeks as string, 10);
  const weeks = Number.isFinite(rawWeeks) && rawWeeks >= 1 && rawWeeks <= 52 ? rawWeeks : 12;
  const trends = await CalendarQuery.getBurnoutTrends(req.user!.id, weeks);
  res.json({ success: true, data: trends });
});

export const getRecommendations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const recommendations = await WellnessService.generateRecommendations(req.user!.id);
  res.json({ success: true, data: recommendations });
});

export const dismissRecommendation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  await WellnessService.dismissRecommendation(id, req.user!.id);
  res.json({ success: true, message: 'Recommendation dismissed' });
});