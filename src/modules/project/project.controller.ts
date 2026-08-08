import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { ProjectQuery } from "./project.query.js";
import { ProjectMutation } from "./project.mutation.js";
import { SprintQuery } from "./project.sprint.query.js";
import { SprintMutation } from "./project.sprint.mutation.js";
import { SectionQuery } from "./project.section.query.js";
import { SectionMutation } from "./project.section.mutation.js";
import { MilestoneQuery } from "./project.milestone.query.js";
import { MilestoneMutation } from "./project.milestone.mutation.js";
import { ProjectViewQuery } from "./project.view.query.js";
import { ProjectViewMutation } from "./project.view.mutation.js";
import { FavoriteQuery } from "./project.favorite.query.js";
import { FavoriteMutation } from "./project.favorite.mutation.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import { ProjectAccess } from "./project.access.js";
import {
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberRoleSchema,
} from "./project.validators.js";
import {
  createSectionSchema,
  updateSectionSchema,
} from "./project.section.validators.js";
import {
  createSprintSchema,
  updateSprintSchema,
} from "./project.sprint.validators.js";
import {
  createMilestoneSchema,
  updateMilestoneSchema,
} from "./project.milestone.validators.js";
import {
  createProjectViewSchema,
  updateProjectViewSchema,
} from "./project.view.validators.js";
import {
  updateFavoriteSchema,
} from "./project.favorite.validators.js";

// ── Project CRUD ─────────────────────────────────────────────────────────────

export const getUserProjects = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const projects = await ProjectQuery.getUserProjects(req.user!.id);
    res.json({ success: true, data: projects });
  },
);

export const getProjectDetails = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const project = await ProjectQuery.getProjectDetails(
      req.user!.id,
      req.params.projectId,
    );
    res.json({ success: true, data: project });
  },
);

export const getProjectBySlug = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const project = await ProjectQuery.getProjectBySlug(
      req.user!.id,
      req.params.slug,
    );
    res.json({ success: true, data: project });
  },
);

export const getProjectsByWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const projects = await ProjectQuery.getProjectsByWorkspace(
      req.user!.id,
      req.params.workspaceId,
    );
    res.json({ success: true, data: projects });
  },
);

export const createProject = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const project = await ProjectMutation.createProject({
      ...parsed.data,
      createdById: req.user!.id,
    });
    res.status(201).json({
      success: true,
      data: project,
      message: "Project created successfully",
    });
  },
);

export const updateProject = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const project = await ProjectMutation.updateProject(
      req.user!.id,
      req.params.projectId,
      parsed.data,
    );
    res.json({
      success: true,
      data: project,
      message: "Project updated successfully",
    });
  },
);

export const deleteProject = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectMutation.deleteProject(req.user!.id, req.params.projectId);
    res.json({ success: true, message: "Project deleted successfully" });
  },
);

// ── Members ──────────────────────────────────────────────────────────────────

export const addProjectMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = addProjectMemberSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const member = await ProjectMutation.addProjectMember(
      req.user!.id,
      req.params.projectId,
      parsed.data,
    );
    res.status(201).json({
      success: true,
      data: member,
      message: "Member added successfully",
    });
  },
);

export const updateProjectMemberRole = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateProjectMemberRoleSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const member = await ProjectMutation.updateProjectMemberRole(
      req.user!.id,
      req.params.projectId,
      req.params.memberId,
      parsed.data,
    );
    res.json({
      success: true,
      data: member,
      message: "Member role updated successfully",
    });
  },
);

export const removeProjectMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectMutation.removeProjectMember(
      req.user!.id,
      req.params.projectId,
      req.params.memberId,
    );
    res.json({ success: true, message: "Member removed successfully" });
  },
);

// ── Sections ─────────────────────────────────────────────────────────────────

export const getProjectSections = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const sections = await SectionQuery.getByProject(req.params.projectId);
    res.json({ success: true, data: sections });
  },
);

export const createProjectSection = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createSectionSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const section = await SectionMutation.create(parsed.data, req.user!.id);
    res.status(201).json({ success: true, data: section });
  },
);

export const updateProjectSection = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateSectionSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const section = await SectionMutation.update(
      req.params.sectionId,
      parsed.data,
      req.user!.id,
    );
    res.json({ success: true, data: section });
  },
);

export const deleteProjectSection = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await SectionMutation.delete(req.params.sectionId, req.user!.id);
    res.json({ success: true, message: "Section deleted" });
  },
);

export const reorderProjectSections = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { sectionIds } = req.body;
    await SectionMutation.reorder(
      req.params.projectId,
      sectionIds,
      req.user!.id,
    );
    res.json({ success: true, message: "Sections reordered" });
  },
);

// ── Sprints ──────────────────────────────────────────────────────────────────

export const getProjectSprints = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const data = await SprintQuery.getSprintStats(req.params.projectId);
    res.json({ success: true, data });
  },
);

export const getActiveSprint = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const sprint = await SprintQuery.getActiveSprint(req.params.projectId);
    res.json({ success: true, data: sprint });
  },
);

export const getSprintById = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const sprint = await SprintQuery.getById(req.params.sprintId, req.params.projectId);
    res.json({ success: true, data: sprint });
  },
);

export const createSprint = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createSprintSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const sprint = await SprintMutation.create(parsed.data, req.user!.id);
    res.status(201).json({ success: true, data: sprint });
  },
);

export const updateSprint = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const sprint = await SprintMutation.update(
      req.params.sprintId,
      parsed.data,
      req.user!.id,
    );
    res.json({ success: true, data: sprint });
  },
);

export const deleteSprint = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await SprintMutation.delete(req.params.sprintId, req.user!.id);
    res.json({ success: true, message: "Sprint deleted" });
  },
);

export const completeSprint = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { retrospective } = req.body;
    const sprint = await SprintMutation.complete(
      req.params.sprintId,
      req.user!.id,
      retrospective,
    );
    res.json({ success: true, data: sprint });
  },
);

// ── Milestones ───────────────────────────────────────────────────────────────

export const getProjectMilestones = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const data = await MilestoneQuery.getMilestoneStats(req.params.projectId);
    res.json({ success: true, data });
  },
);

export const getMilestoneById = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const milestone = await MilestoneQuery.getById(req.params.milestoneId, req.params.projectId);
    res.json({ success: true, data: milestone });
  },
);

export const createMilestone = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createMilestoneSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const milestone = await MilestoneMutation.create(parsed.data, req.user!.id);
    res.status(201).json({ success: true, data: milestone });
  },
);

export const updateMilestone = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateMilestoneSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const milestone = await MilestoneMutation.update(
      req.params.milestoneId,
      parsed.data,
      req.user!.id,
    );
    res.json({ success: true, data: milestone });
  },
);

export const deleteMilestone = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await MilestoneMutation.delete(req.params.milestoneId, req.user!.id);
    res.json({ success: true, message: "Milestone deleted" });
  },
);

export const updateMilestoneProgress = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { progress } = req.body;
    const milestone = await MilestoneMutation.updateProgress(
      req.params.milestoneId,
      progress,
      req.user!.id,
    );
    res.json({ success: true, data: milestone });
  },
);

// ── Project Views ────────────────────────────────────────────────────────────

export const getProjectViews = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectAccess.assertProjectAccess(req.user!.id, req.params.projectId);
    const views = await ProjectViewQuery.getByProject(
      req.params.projectId,
      req.user!.id,
    );
    res.json({ success: true, data: views });
  },
);

export const createProjectView = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createProjectViewSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const view = await ProjectViewMutation.create(
      { ...parsed.data, createdById: req.user!.id },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: view });
  },
);

export const updateProjectView = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateProjectViewSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const view = await ProjectViewMutation.update(
      req.params.viewId,
      parsed.data,
      req.user!.id,
    );
    res.json({ success: true, data: view });
  },
);

export const deleteProjectView = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await ProjectViewMutation.delete(req.params.viewId, req.user!.id);
    res.json({ success: true, message: "View deleted" });
  },
);

// ── Favorites ────────────────────────────────────────────────────────────────

export const getUserFavorites = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const data = await FavoriteQuery.getByUser(req.user!.id);
    res.json({ success: true, data });
  },
);

export const checkFavorite = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const favorited = await FavoriteQuery.isFavorited(
      req.params.projectId,
      req.user!.id,
    );
    res.json({ success: true, data: { favorited } });
  },
);

export const toggleFavorite = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const result = await FavoriteMutation.toggle(
      req.params.projectId,
      req.user!.id,
    );
    res.json({ success: true, data: result });
  },
);

export const updateFavorite = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateFavoriteSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const fav = await FavoriteMutation.update(
      req.params.projectId,
      req.user!.id,
      parsed.data,
    );
    res.json({ success: true, data: fav });
  },
);
