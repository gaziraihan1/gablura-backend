import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { FileManagementQuery }    from './fileManagement.query.js';
import { FileManagementMutation } from './fileManagement.mutation.js';
import type { FileFilters }       from './fileManagement.types.js';
import { asyncHandler }           from '../../errors/index.js';

export const getFiles = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId } = req.params;
  const {
    search, fileType, uploadedBy,
    dateFrom, dateTo, sortBy, sortOrder,
    page  = '1',
    limit = '50',
  } = req.query;

  const filters: FileFilters = {
    search:     search     as string,
    fileType:   fileType   as string,
    uploadedBy: uploadedBy as string,
    dateFrom:   dateFrom ? new Date(dateFrom as string) : undefined,
    dateTo:     dateTo   ? new Date(dateTo   as string) : undefined,
    sortBy:     sortBy     as 'name' | 'size' | 'date',
    sortOrder:  sortOrder  as 'asc'  | 'desc',
  };

  const result = await FileManagementQuery.getFiles(
    workspaceId,
    req.user!.id,
    filters,
    parseInt(page  as string),
    parseInt(limit as string),
  );

  res.json({ success: true, data: result });
});

export const deleteFile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId, fileId } = req.params;
  await FileManagementMutation.deleteFile(fileId, workspaceId, req.user!.id);
  res.json({ success: true, message: 'File deleted successfully' });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await FileManagementQuery.getFileTypeStats(req.params.workspaceId, req.user!.id);
  res.json({ success: true, data: stats });
});

export const getUploaders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const uploaders = await FileManagementQuery.getUploaders(req.params.workspaceId, req.user!.id);
  res.json({ success: true, data: uploaders });
});