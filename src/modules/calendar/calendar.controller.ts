import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { CalendarAggregation }     from './calendar.aggregation.js';
import { CalendarInsightsService } from './calendar.insights.js';
import { CalendarQuery }           from './calendar.query.js';
import { CalendarMutation }        from './calendar.mutation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  calendarRangeSchema,
  createGoalCheckpointSchema,
  recalculateSchema,
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