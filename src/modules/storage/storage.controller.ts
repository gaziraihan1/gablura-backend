import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../../middleware/auth.js';
import { StorageQuery }    from './storage.query.js';
import { StorageMutation } from './storage.mutation.js';
import { StorageAccess }   from './storage.access.js';
import {
  largestFilesQuerySchema,
  bulkDeleteSchema,
  checkUploadSchema,
} from './storage.validators.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL, StorageCache } from '../../lib/redis/cache.client.js';
import { asyncHandler } from '../../errors/asyncHandler.js';
import { UnauthorizedError } from '../../errors/AppError.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function requireUserId(req: AuthRequest): string {
  if (!req.user?.id) throw new UnauthorizedError();
  return req.user.id;
}


// ─── Read handlers (cache-aside) ──────────────────────────────────────────────

export const getWorkspacesSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  
    const userId = requireUserId(req);
    if (!userId) return;

    const cacheKey = CACHE_KEYS.storageWorkspacesSummary(userId);
    const data = await CacheClient.getOrSet(
      cacheKey,
      () => StorageQuery.getUserWorkspacesSummary(userId),
      CACHE_TTL.STORAGE_WORKSPACES_SUMMARY,
    );

    res.json({ success: true, data })}) 


export const getWorkspaceOverview = asyncHandler (async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { workspaceId } = req.params;
    const cacheKey = CACHE_KEYS.storageOverview(workspaceId, userId);

    const data = await CacheClient.getOrSet(
      cacheKey,
      async () => {
        // Run access check + isAdmin in one query, then fetch everything else in parallel.
        const [isAdmin, storageInfo, breakdown, largestFiles, trend, fileTypes, myContribution] =
          await Promise.all([
            StorageAccess.isAdmin(userId, workspaceId),
            StorageQuery.getWorkspaceStorageInfo(workspaceId, userId),
            StorageQuery.getWorkspaceStorageBreakdown(workspaceId, userId),
            StorageQuery.getLargestFiles(workspaceId, userId, 10),
            StorageQuery.getStorageTrend(workspaceId, userId, 30),
            StorageQuery.getFileTypeBreakdown(workspaceId, userId),
            StorageQuery.getMyContribution(workspaceId, userId),
          ]);

        // Admin-only: per-user breakdown (extra query only when needed)
        const userContributions = isAdmin
          ? await StorageQuery.getUserContributions(workspaceId, userId)
          : null;

        return { storageInfo, breakdown, largestFiles, trend, fileTypes, myContribution, userContributions, isAdmin };
      },
      CACHE_TTL.STORAGE_OVERVIEW,
    );

    res.json({ success: true, data });
});

export const getWorkspaceInfo = asyncHandler (async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { workspaceId } = req.params;
    const cacheKey = CACHE_KEYS.storageInfo(workspaceId, userId);

    const data = await CacheClient.getOrSet(
      cacheKey,
      () => StorageQuery.getWorkspaceStorageInfo(workspaceId, userId),
      CACHE_TTL.STORAGE_INFO,
    );

    res.json({ success: true, data });
});

export const getMyContribution = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { workspaceId } = req.params;
    const cacheKey = CACHE_KEYS.storageMyContribution(workspaceId, userId);

    const data = await CacheClient.getOrSet(
      cacheKey,
      () => StorageQuery.getMyContribution(workspaceId, userId),
      CACHE_TTL.STORAGE_MY_CONTRIBUTION,
    );

    res.json({ success: true, data });
})

export const getUserContributions = asyncHandler( async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { workspaceId } = req.params;
    const cacheKey = CACHE_KEYS.storageUserContributions(workspaceId);

    const data = await CacheClient.getOrSet(
      cacheKey,
      () => StorageQuery.getUserContributions(workspaceId, userId),
      CACHE_TTL.STORAGE_USER_CONTRIBUTIONS,
    );

    res.json({ success: true, data });
})

export const getLargestFiles = asyncHandler (async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { workspaceId } = req.params;
    const { limit } = largestFilesQuerySchema.parse(req.query);
    const cacheKey = CACHE_KEYS.storageLargestFiles(workspaceId, limit);

    const data = await CacheClient.getOrSet(
      cacheKey,
      () => StorageQuery.getLargestFiles(workspaceId, userId, limit),
      CACHE_TTL.STORAGE_LARGEST_FILES,
    );

    res.json({ success: true, data });
});

// ─── Mutation handlers (invalidate after write) ───────────────────────────────

export const bulkDelete = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const { workspaceId } = req.params;
  const { fileIds } = bulkDeleteSchema.parse(req.body);

  // StorageMutation now throws on failure — no result.success check needed
  const result = await StorageMutation.bulkDeleteFiles(fileIds, workspaceId, userId);
  await StorageCache.invalidateAll(workspaceId, userId);

  res.json({
    success: true,
    message: result.message,
    data: { deletedCount: result.deletedCount, freedMB: result.freedMB },
  });
});
export const deleteFile = asyncHandler( async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const result = await StorageMutation.deleteFile(req.params.fileId, userId);

    if (!result.success) {
      res.status(result.message.includes('permission') ? 403 : 404).json({
        success: false,
        message: result.message,
      });
      return;
    }

    // workspaceId isn't on the route param here, so invalidate across all
    // workspace patterns for this user. StorageMutation already knows the
    // workspaceId — expose it from the result so we can do a precise wipe.
    if (result.workspaceId) {
      await StorageCache.invalidateAll(result.workspaceId, userId);
    } else {
      // Fallback: wipe only the user-level summary (workspace keys stay stale
      // until their short TTL expires — acceptable for a rare code path).
      await StorageCache.invalidateUserSummary(userId);
    }

    res.json({ success: true, message: result.message, data: { freedMB: result.freedMB } });
})

export const checkUpload = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return;

    const { fileSize } = checkUploadSchema.parse(req.body);
    // check-upload is a read-only pre-flight — no caching needed (always real-time)
    const result = await StorageMutation.canUploadFile(req.params.workspaceId, userId, fileSize);

    res.json({
      success: result.allowed,
      data:    result,
      message: result.allowed ? 'Upload allowed' : result.reason,
    });
})