import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { LabelQuery }    from './label.query.js';
import { LabelMutation } from './label.mutation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  createLabelSchema,
  updateLabelSchema,
  popularLabelsQuerySchema,
  labelsQuerySchema,
  labelTasksQuerySchema,
} from './label.validators.js';

export const getLabels = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = labelsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await LabelQuery.getLabels(req.user!.id, parsed.data);
  res.json({ success: true, ...result });
});

export const getPopularLabels = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = popularLabelsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await LabelQuery.getPopularLabels(req.user!.id, parsed.data);
  res.json({ success: true, ...result });
});

export const getLabelById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const label = await LabelQuery.getLabel(req.params.id, req.user!.id);
  res.json({ success: true, data: label });
});

export const getLabelTasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = labelTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const result = await LabelQuery.getLabelTasks(req.params.id, req.user!.id, parsed.data);
  res.json({ success: true, ...result });
});

export const createLabel = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createLabelSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const label = await LabelMutation.createLabel({ ...parsed.data, createdById: req.user!.id });
  res.status(201).json({ success: true, data: label, message: 'Label created successfully' });
});

export const updateLabel = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateLabelSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const label = await LabelMutation.updateLabel(req.params.id, req.user!.id, parsed.data);
  res.json({ success: true, data: label, message: 'Label updated successfully' });
});

export const deleteLabel = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await LabelMutation.deleteLabel(req.params.id, req.user!.id);
  res.json({
    success: true,
    message: 'Label deleted successfully',
    data:    { tasksAffected: result.tasksAffected },
  });
});

export const addLabelToTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { labelId, taskId } = req.params;
  const taskLabel = await LabelMutation.addLabelToTask(labelId, taskId, req.user!.id);
  res.status(201).json({ success: true, data: taskLabel, message: 'Label added to task successfully' });
});

export const removeLabelFromTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { labelId, taskId } = req.params;
  await LabelMutation.removeLabelFromTask(labelId, taskId, req.user!.id);
  res.json({ success: true, message: 'Label removed from task successfully' });
});