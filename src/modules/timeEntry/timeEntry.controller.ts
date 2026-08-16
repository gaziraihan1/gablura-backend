import type { Response }     from 'express';
import type { AuthRequest }  from '../../middleware/auth.js';
import { TimeEntryQuery }    from './timeEntry.query.js';
import { TimeEntryMutation } from './timeEntry.mutation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  myTimeEntriesQuerySchema,
} from './timeEntry.validators.js';

export const getTaskEntries = asyncHandler(async (req: AuthRequest, res: Response) => {
  const entries = await TimeEntryQuery.getTaskEntries(req.params.taskId, req.user!.id);
  res.json({ success: true, data: entries });
});

export const getMyEntries = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = myTimeEntriesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const entries = await TimeEntryQuery.getMyEntries(req.user!.id, parsed.data);
  res.json({ success: true, data: entries });
});

export const createTimeEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createTimeEntrySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const entry = await TimeEntryMutation.createEntry({
    ...parsed.data,
    userId: req.user!.id,
  });
  res.status(201).json({ success: true, data: entry, message: 'Time entry created' });
});

export const updateTimeEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTimeEntrySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const entry = await TimeEntryMutation.updateEntry(req.params.id, req.user!.id, parsed.data);
  res.json({ success: true, data: entry, message: 'Time entry updated' });
});

export const deleteTimeEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  await TimeEntryMutation.deleteEntry(req.params.id, req.user!.id);
  res.json({ success: true, message: 'Time entry deleted' });
});
