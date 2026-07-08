import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { AnnouncementService } from "./announcement.service.js";
import { prisma } from "../../lib/prisma.js";
import {
  notifyWorkspaceMembers,
  notifyUser,
} from "../notification/notification.helpers.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";
import {
  createAnnouncementSchema,
  listAnnouncementsSchema,
} from "./announcement.validation.js";


export const createAnnouncement = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const { workspaceSlug } = req.params;
    const workspace = await prisma.workspace.findUniqueOrThrow({
  where: { slug: workspaceSlug },
  select: { id: true },
});

    const announcement = await AnnouncementService.create(
      { ...parsed.data, workspaceSlug, createdById: req.user!.id },
      async ({ announcement, workspaceSlug: wsSlug, creatorName }) => {
        const actionUrl = `/dashboard/workspaces/${workspaceSlug}/announcements/${announcement.id}`;

        void prisma.activity
          .create({
            data: {
              action: "CREATED",
              entityType: "ANNOUNCEMENT",
              entityId: announcement.id,
              user: { connect: { id: req.user!.id } },
              workspace: { connect: { id: workspace.id } },
              workspaceSlug: wsSlug,
              metadata: {
                announcementTitle: announcement.title,
                visibility: announcement.visibility,
                isPinned: announcement.isPinned,
              },
            },
          })
          .catch((e) =>
            console.error("Failed to log announcement activity:", e),
          );

        if (announcement.visibility === "PUBLIC") {
          void notifyWorkspaceMembers({
            workspaceSlug: wsSlug,
            workspaceId: workspace.id,
            senderId: req.user!.id,
            type: "PROJECT_UPDATE",
            title: "📢 New Announcement",
            message: `${creatorName}: ${announcement.title}`,
            actionUrl,
            excludeUserId: req.user!.id,
          });
        } else {
          const targetIds = (announcement.targets ?? [])
            .map((t: any) => t.userId)
            .filter((uid: string) => uid !== req.user!.id);

          await Promise.allSettled(
            targetIds.map((userId: string) =>
              notifyUser({
                userId,
                senderId: req.user!.id,
                type: "PROJECT_UPDATE",
                title: "🔒 Private Announcement",
                message: `${creatorName} shared an announcement with you: ${announcement.title}`,
                actionUrl,
              }),
            ),
          );
        }
      },
    );

    res
      .status(201)
      .json({
        success: true,
        message: "Announcement created",
        data: announcement,
      });
  },
);

export const getAnnouncements = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { workspaceSlug } = req.params;
    console.log("PARAM KEYS:", Object.keys(req.params));
console.log("PARAMS:", req.params);
    console.log(workspaceSlug)
    const parsed = listAnnouncementsSchema.safeParse(req.query);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const result = await AnnouncementService.getMany({
      workspaceSlug,
      userId: req.user!.id,
      ...parsed.data,
    });

    res.json({ success: true, ...result });
  },
);

export const getAnnouncement = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const announcement = await AnnouncementService.getOne(
      req.params.id,
      req.user!.id,
    );
    res.json({ success: true, data: announcement });
  },
);

export const getProjectAnnouncements = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { workspaceSlug, projectId } = req.params;
    const parsed = listAnnouncementsSchema.safeParse(req.query);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const result = await AnnouncementService.getMany({
      workspaceSlug,
      projectId,
      userId: req.user!.id,
      ...parsed.data,
    });

    res.json({ success: true, ...result });
  },
);

export const deleteAnnouncement = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await AnnouncementService.delete(
      req.params.id,
      req.user!.id,
      async ({ announcement, workspaceSlug }) => {
        void prisma.activity
          .create({
            data: {
              action: "DELETED",
              entityType: "ANNOUNCEMENT",
              entityId: announcement.id,
              user: { connect: { id: req.user!.id } },
              workspace: { connect: { slug: workspaceSlug } },
              workspaceSlug,
              metadata: { announcementTitle: announcement.title },
            },
          })
          .catch((e) =>
            console.error("Failed to log announcement deletion:", e),
          );
      },
    );

    res.json({ success: true, message: "Announcement deleted successfully" });
  },
);

export const togglePinAnnouncement = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const announcement = await AnnouncementService.togglePin(
      req.params.id,
      req.user!.id,
    );
    res.json({ success: true, data: announcement });
  },
);
