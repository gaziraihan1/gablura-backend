import { prisma } from "../../lib/prisma.js";
import { addInvalidateCacheJob } from "../../queue/index.js";

export const AttachmentRepository = {
  aggregateWorkspaceSize(workspaceId: string) {
    return prisma.file.aggregate({
      where: { workspaceId },
      _sum: { size: true },
    });
  },

  createFile(data: any) {
    return prisma.file.create({
      data,
      include: {
        uploadedBy: { select: { id: true, name: true, image: true } },
      },
    });
  },

  deleteFile(fileId: string) {
    return prisma.file.deleteMany({
      where: { id: fileId },
    });
  },

  createActivity(data: any) {
    return prisma.activity.create({ data }).then((activity) => {
      // Refresh activity feeds/timelines so newly logged activities (task/comment
      // updates, uploads, etc.) are visible without waiting for the cache TTL.
      addInvalidateCacheJob({
        type: 'activity',
        workspaceId: data?.workspaceId ?? undefined,
        userId:      data?.userId ?? undefined,
        taskId:      data?.taskId ?? undefined,
      }).catch(() => {});
      return activity;
    });
  },
};