import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { ProjectQuery } from "./project.query.js";
import { ProjectMutation } from "./project.mutation.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import {
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberRoleSchema,
} from "./project.validators.js";

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
    res
      .status(201)
      .json({
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
    res
      .status(201)
      .json({
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
