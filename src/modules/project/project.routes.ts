import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import {
  getUserProjects,
  getProjectsByWorkspace,
  getProjectDetails,
  createProject,
  updateProject,
  deleteProject,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  getProjectBySlug,
  // Sections
  getProjectSections,
  createProjectSection,
  updateProjectSection,
  deleteProjectSection,
  reorderProjectSections,
  // Sprints
  getProjectSprints,
  getActiveSprint,
  getSprintById,
  createSprint,
  updateSprint,
  deleteSprint,
  completeSprint,
  // Milestones
  getProjectMilestones,
  getMilestoneById,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  updateMilestoneProgress,
  // Views
  getProjectViews,
  createProjectView,
  updateProjectView,
  deleteProjectView,
  // Favorites
  getUserFavorites,
  checkFavorite,
  toggleFavorite,
  updateFavorite,
} from './project.controller.js';
import { requireProjectSlot } from '../billing/index.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

// ── Project CRUD ─────────────────────────────────────────────────────────────

router.get('/user/all',                 getUserProjects);
router.get('/workspace/:workspaceId',   getProjectsByWorkspace);

router.post('/',                        requireProjectSlot, createProject);
router.get('/slug/:slug',               getProjectBySlug);
router.get('/:projectId',               getProjectDetails);
router.patch('/:projectId',             updateProject);
router.delete('/:projectId',            deleteProject);

// ── Members ──────────────────────────────────────────────────────────────────

router.post('/:projectId/members',                      addProjectMember);
router.patch('/:projectId/members/:memberId',            updateProjectMemberRole);
router.delete('/:projectId/members/:memberId',           removeProjectMember);

// ── Sections ─────────────────────────────────────────────────────────────────

router.get('/:projectId/sections',                  getProjectSections);
router.post('/:projectId/sections',                 createProjectSection);
router.put('/:projectId/sections/reorder',          reorderProjectSections);
router.patch('/:projectId/sections/:sectionId',     updateProjectSection);
router.delete('/:projectId/sections/:sectionId',    deleteProjectSection);

// ── Sprints ──────────────────────────────────────────────────────────────────

router.get('/:projectId/sprints',                getProjectSprints);
router.get('/:projectId/sprints/active',         getActiveSprint);
router.post('/:projectId/sprints',               createSprint);
router.get('/:projectId/sprints/:sprintId',      getSprintById);
router.patch('/:projectId/sprints/:sprintId',    updateSprint);
router.post('/:projectId/sprints/:sprintId/complete', completeSprint);
router.delete('/:projectId/sprints/:sprintId',   deleteSprint);

// ── Milestones ───────────────────────────────────────────────────────────────

router.get('/:projectId/milestones',                  getProjectMilestones);
router.post('/:projectId/milestones',                 createMilestone);
router.get('/:projectId/milestones/:milestoneId',     getMilestoneById);
router.patch('/:projectId/milestones/:milestoneId',   updateMilestone);
router.put('/:projectId/milestones/:milestoneId/progress', updateMilestoneProgress);
router.delete('/:projectId/milestones/:milestoneId',  deleteMilestone);

// ── Project Views ────────────────────────────────────────────────────────────

router.get('/:projectId/views',              getProjectViews);
router.post('/:projectId/views',             createProjectView);
router.patch('/:projectId/views/:viewId',    updateProjectView);
router.delete('/:projectId/views/:viewId',   deleteProjectView);

// ── Favorites ────────────────────────────────────────────────────────────────

router.get('/favorites/mine',             getUserFavorites);
router.get('/:projectId/favorite',        checkFavorite);
router.post('/:projectId/favorite/toggle', toggleFavorite);
router.put('/:projectId/favorite',        updateFavorite);

export default router;
