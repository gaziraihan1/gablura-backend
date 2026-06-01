import { prisma }                              from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../errors/index.js';

export const AttachmentAccess = {
  async assertCanAttach(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id:        taskId,
        projectId: { not: null },
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { workspace: { members: { some: { userId } } } } },
        ],
      },
      select: {
        id: true,
        project: {
          select: {
            workspaceId: true,
            workspace: {
              select: {
                id:      true,
                plan:    true,
                members: { where: { userId }, select: { role: true } },
              },
            },
          },
        },
      },
    });

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    if (!task.project?.workspaceId) {
      throw new BadRequestError('Personal tasks cannot have attachments');
    }

    return {
      workspaceId:   task.project.workspaceId,
      workspacePlan: task.project.workspace?.plan ?? 'FREE',
      userRole:      task.project.workspace?.members[0]?.role,
    };
  },

  async assertCanDelete(fileId: string, userId: string) {
    const file = await prisma.file.findFirst({
      where:  { id: fileId },
      select: {
        id:           true,
        name:         true,
        originalName: true,
        size:         true,
        taskId:       true,
        uploadedById: true,
        workspaceId:  true,
        workspace: {
          select: {
            members: { where: { userId }, select: { role: true } },
          },
        },
      },
    });

    if (!file) throw new NotFoundError('File');

    const isUploader = file.uploadedById === userId;
    const isAdmin    =
      file.workspace?.members[0]?.role === 'OWNER' ||
      file.workspace?.members[0]?.role === 'ADMIN';

    if (!isUploader && !isAdmin) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }

    return file;
  },

  async assertCanViewStats(workspaceId: string, userId: string) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId, role: { in: ['OWNER', 'ADMIN'] } },
    });

    if (!member) {
      throw new ForbiddenError('Only workspace owners and admins can view attachment statistics');
    }
  },
};