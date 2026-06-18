import { Router } from 'express';
import {
  getAdminStats,
  getAdminWorkspaces,
  getAdminWorkspaceDetail,
  getAdminUsers,
  getAdminUserDetail,
  getAdminProjects,
  getAdminBilling,
  getAdminActivity,
  banUser,
  unbanUser,
  deleteWorkspace,
  restoreWorkspace,
  updateWorkspaceLimits,
} from './admin.controller.js';

export const adminRouter = Router();

adminRouter.get('/stats',                  getAdminStats);
adminRouter.get('/workspaces',             getAdminWorkspaces);
adminRouter.get('/workspaces/:slug',       getAdminWorkspaceDetail);  // slug not id
adminRouter.get('/users',                  getAdminUsers);
adminRouter.get('/users/:id',              getAdminUserDetail);
adminRouter.get('/projects',               getAdminProjects);
adminRouter.get('/billing',                getAdminBilling);
adminRouter.get('/activity',               getAdminActivity);
adminRouter.patch('/workspaces/:slug/limits', updateWorkspaceLimits);
adminRouter.patch('/users/:id/ban',              banUser);
adminRouter.patch('/users/:id/unban',            unbanUser);
adminRouter.post('/workspaces/:slug',          deleteWorkspace);
adminRouter.patch('/workspaces/:slug/restore',   restoreWorkspace);