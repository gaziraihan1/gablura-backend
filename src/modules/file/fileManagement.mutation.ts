import { prisma }                      from '../../lib/prisma.js';
import { FileManagementAccess }        from './fileManagement.access.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

export const FileManagementMutation = {
  async deleteFile(fileId: string, workspaceId: string, userId: string): Promise<void> {
    await FileManagementAccess.assertWorkspaceMember(userId, workspaceId);
    const isAdmin = await FileManagementAccess.isWorkspaceAdmin(userId, workspaceId);

    const file = await prisma.file.findUnique({
      where:  { id: fileId },
      select: { id: true, workspaceId: true, uploadedById: true },
    });

    if (!file || file.workspaceId !== workspaceId) throw new NotFoundError('File');
    if (!isAdmin && file.uploadedById !== userId) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }

    await prisma.file.delete({ where: { id: fileId } });
  },
};