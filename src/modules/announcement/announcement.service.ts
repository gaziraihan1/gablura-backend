import { AnnouncementRepository } from './announcement.repository.js';
import {
  canManageAnnouncements,
  canManageProjectAnnouncements,
  canViewAnnouncement,
} from './announcement.utils.js';
import type {
  CreateAnnouncementInput,
  AnnouncementFilterParams,
} from './announcement.types.js';
import { WorkspaceRole } from '../workspace/workspace.types.js';
import { prisma }        from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../errors/index.js';

type OnAnnouncementCreated = (data: {
  announcement: any;
  workspaceSlug:  string;
  creatorName:  string;
}) => Promise<void>;

type OnAnnouncementDeleted = (data: {
  announcement: any;
  workspaceSlug:  string;
}) => Promise<void>;

export const AnnouncementService = {
  async create(input: CreateAnnouncementInput, onCreated?: OnAnnouncementCreated) {
    const member = await AnnouncementRepository.isWorkspaceMember(
      input.workspaceSlug,
      input.createdById,
    );
    
    if (!member) {
      throw new ForbiddenError('You are not a member of this workspace');
    }
    const workspaceRole = member.role as WorkspaceRole;
    
    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where:  { id: input.projectId, workspaceSlug : input.workspaceSlug },
        select: { id: true },
      });
      if (!project) throw new BadRequestError('Invalid project for workspace');

      const projectMember = await AnnouncementRepository.isProjectMember(
        input.projectId,
        input.createdById,
      );
      if (!canManageProjectAnnouncements(workspaceRole, projectMember?.role ?? null)) {
        throw new ForbiddenError('Not allowed to create project announcements');
      }
    } else {
      if (!canManageAnnouncements(workspaceRole)) {
        throw new ForbiddenError('Only admins and owners can create workspace announcements');
      }
    }

    if (input.visibility === 'PRIVATE') {
      if (!input.targetIds || input.targetIds.length === 0) {
        throw new BadRequestError('Private announcements must have targets');
      }

      const checks = await Promise.all(
        input.targetIds.map((uid) =>
          AnnouncementRepository.isWorkspaceMember(input.workspaceSlug, uid),
        ),
      );
      const invalid = input.targetIds.filter((_, i) => !checks[i]);
      if (invalid.length) {
        throw new BadRequestError('Some target users are not workspace members');
      }
    }

    const announcement = await AnnouncementRepository.create(input);

    if (onCreated) {
      await onCreated({
        announcement,
        workspaceSlug: input.workspaceSlug,
        creatorName: announcement.createdBy.name ?? 'Someone',
      }).catch((e) => console.error("Error in onCreated callback:", e));
    }

    return announcement;
  },

  async getMany(params: AnnouncementFilterParams) {
    const member = await AnnouncementRepository.isWorkspaceMember(
      params.workspaceSlug,
      params.userId,
    );
    const guest = await AnnouncementRepository.isWorkspaceGuest(
      params.workspaceSlug,
      params.userId,
    );
    const isPublic = await AnnouncementRepository.isPUblicWorkspace(params.workspaceSlug);
    if (!member && !isPublic && !guest) throw new ForbiddenError('You do not have access to this workspace');

  

    const workspaceRole = member?.role as WorkspaceRole;

    if (params.projectId !== undefined) {
      const project = await prisma.project.findFirst({
        where:  { id: params.projectId!, workspaceSlug : params.workspaceSlug },
        select: { id: true },
      });
      if (!project) throw new ForbiddenError('Invalid project access');

      const projectMember = await AnnouncementRepository.isProjectMember(
        params.projectId!,
        params.userId,
      );
      if (!canManageProjectAnnouncements(workspaceRole, projectMember?.role ?? null) && !projectMember) {
        throw new ForbiddenError('You are not a member of this project');
      }
    }

    return AnnouncementRepository.findMany(params);
  },

  async getOne(id: string, userId: string) {
    const announcement = await AnnouncementRepository.findById(id);
    if (!announcement) throw new NotFoundError('Announcement');

    if (!canViewAnnouncement(announcement, userId)) {
      throw new ForbiddenError('You do not have access to this announcement');
    }

    return announcement;
  },

  async delete(id: string, userId: string, onDeleted?: OnAnnouncementDeleted) {
    const announcement = await AnnouncementRepository.findById(id);
    if (!announcement) throw new NotFoundError('Announcement');

    const member = await AnnouncementRepository.isWorkspaceMember(
      announcement.workspaceSlug,
      userId,
    );
    if (!member) throw new ForbiddenError('Not a workspace member');

    const workspaceRole = member.role as WorkspaceRole;

    if (announcement.projectId) {
      const projectMember = await AnnouncementRepository.isProjectMember(
        announcement.projectId,
        userId,
      );
      if (!canManageProjectAnnouncements(workspaceRole, projectMember?.role ?? null)) {
        throw new ForbiddenError('Not allowed to delete project announcements');
      }
    } else {
      if (!canManageAnnouncements(workspaceRole)) {
        throw new ForbiddenError('Only admins and owners can delete announcements');
      }
    }

    await AnnouncementRepository.delete(id);

    if (onDeleted) {
      await onDeleted({ announcement, workspaceSlug: announcement.workspaceSlug })
        .catch((e) => console.error("Error in onDeleted callback:", e));
    }
  },

  async togglePin(id: string, userId: string) {
    const announcement = await AnnouncementRepository.findById(id);
    if (!announcement) throw new NotFoundError('Announcement');

    const member = await AnnouncementRepository.isWorkspaceMember(
      announcement.workspaceSlug,
      userId,
    );
    if (!member) throw new ForbiddenError('Not a workspace member');

    const workspaceRole = member.role as WorkspaceRole;

    if (announcement.projectId) {
      const projectMember = await AnnouncementRepository.isProjectMember(
        announcement.projectId,
        userId,
      );
      if (!canManageProjectAnnouncements(workspaceRole, projectMember?.role ?? null)) {
        throw new ForbiddenError('Not allowed to pin project announcements');
      }
    } else {
      if (!canManageAnnouncements(workspaceRole)) {
        throw new ForbiddenError('Only admins and owners can pin announcements');
      }
    }

    return AnnouncementRepository.update(id, { isPinned: !announcement.isPinned });
  },
};