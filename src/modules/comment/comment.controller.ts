import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { CommentQuery } from "./comment.query.js";
import { CommentMutation } from "./comment.mutation.js";
import { CommentActivity } from "./comment.activity.js";
import { prisma } from "../../lib/prisma.js";
import { taskForActivitySelect } from "./comment.selects.js";
import {
  createCommentSchema,
  updateCommentSchema,
} from "./comment.validators.js";
import { notifyMentions, notifyUser } from "../notification/index.js";
import { stripMentionSyntax, extractMentionedUserIds } from "./mention/mention.utils.js";
import { addBatchInvalidateCacheJob } from "../../queue/index.js";
import { emitAutomationEvent } from "../automation/automation.events.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";

export const getComments = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const comments = await CommentQuery.getComments(
      req.params.taskId,
      req.user!.id,
    );
    res.json({ success: true, data: comments });
  },
);

export const addComment = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { taskId } = req.params;
    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const comment = await CommentMutation.createComment(
      { taskId, userId: req.user!.id, ...parsed.data },
      async ({ commentId, content, parentId }) => {
        const [task, parentComment] = await Promise.all([
          prisma.task.findUnique({
            where: { id: taskId },
            select: taskForActivitySelect,
          }),
          parentId
            ? prisma.comment.findUnique({
                where: { id: parentId },
                select: {
                  userId: true,
                  user: { select: { notifications: true } },
                },
              })
            : Promise.resolve(null),
        ]);

        if (!task?.project?.workspaceId) return;

        const workspaceId = task.project.workspaceId;
        const plainContent = stripMentionSyntax(content);
        const senderName = req.user!.name ?? "Someone";
        const actionUrl = `/dashboard/tasks/${taskId}`;
        const notifiedIds = new Set([req.user!.id]);

        const jobs: Promise<unknown>[] = [
          CommentActivity.logCreated({
            commentId,
            taskId,
            taskTitle: task.title,
            userId: req.user!.id,
            workspaceId,
            commentPreview: plainContent.substring(0, 100),
          }),
        ];

        if (
          !notifiedIds.has(task.createdById) &&
          task.createdBy?.notifications
        ) {
          notifiedIds.add(task.createdById);
          jobs.push(
            notifyUser({
              userId: task.createdById,
              senderId: req.user!.id,
              type: "TASK_COMMENTED",
              title: "New comment on your task",
              message: `${senderName} commented on "${task.title}"`,
              actionUrl,
            }),
          );
        }

        for (const a of task.assignees ?? []) {
          if (!notifiedIds.has(a.userId) && a.user?.notifications) {
            notifiedIds.add(a.userId);
            jobs.push(
              notifyUser({
                userId: a.userId,
                senderId: req.user!.id,
                type: "TASK_COMMENTED",
                title: "New comment on a task",
                message: `${senderName} commented on "${task.title}"`,
                actionUrl,
              }),
            );
          }
        }

        if (
          parentComment &&
          !notifiedIds.has(parentComment.userId) &&
          parentComment.user.notifications
        ) {
          jobs.push(
            notifyUser({
              userId: parentComment.userId,
              senderId: req.user!.id,
              type: "TASK_COMMENTED",
              title: "New reply on your comment",
              message: `${senderName} replied to your comment on "${task.title}"`,
              actionUrl,
            }),
          );
        }

        if (content) {
          jobs.push(
            notifyMentions({
              text: content,
              workspaceId,
              senderId: req.user!.id,
              senderName,
              context: `a comment on "${task.title}"`,
              actionUrl,
            }),
          );
        }

        await Promise.allSettled(jobs);

        // Emit a MENTION automation event so rules can react to mentions
        // (e.g. auto-assign the mentioned user). Only when someone is actually
        // mentioned — no event, no worker work.
        const mentionedUserIds = extractMentionedUserIds(content);
        if (mentionedUserIds.length > 0) {
          void emitAutomationEvent({
            trigger: 'MENTION',
            taskId,
            actorId: req.user!.id,
            workspaceId,
            projectId: task.project?.id ?? null,
            mentionedUserIds,
          });
        }

        // Refresh workspace/user activity feeds and task stats (async, best-effort)
        addBatchInvalidateCacheJob([
          { type: 'activity', taskId, userId: req.user!.id, workspaceId },
          { type: 'task', taskId, userId: req.user!.id, workspaceId },
        ]).catch(() => {});
      },
    );

    res.status(201).json({ success: true, data: comment });
  },
);

export const updateComment = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { taskId, commentId } = req.params;
    const parsed = updateCommentSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const updated = await CommentMutation.updateComment(
      commentId,
      taskId,
      req.user!.id,
      parsed.data,
      async ({ oldContent, newContent }) => {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { title: true, project: { select: { workspaceId: true } } },
        });
        if (!task?.project?.workspaceId) return;

        void CommentActivity.logUpdated({
          commentId,
          taskId,
          taskTitle: task.title,
          userId: req.user!.id,
          workspaceId: task.project.workspaceId,
          oldContent: oldContent!.substring(0, 50),
          newContent: newContent!.substring(0, 50),
        });

        addBatchInvalidateCacheJob([
          { type: 'activity', taskId, userId: req.user!.id, workspaceId: task.project.workspaceId },
          { type: 'task', taskId, userId: req.user!.id, workspaceId: task.project.workspaceId },
        ]).catch(() => {});
      },
    );

    res.json({ success: true, data: updated });
  },
);

export const deleteComment = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { taskId, commentId } = req.params;

    await CommentMutation.deleteComment(
      commentId,
      taskId,
      req.user!.id,
      async ({ content }) => {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { title: true, project: { select: { workspaceId: true } } },
        });
        if (!task?.project?.workspaceId) return;

        void CommentActivity.logDeleted({
          commentId,
          taskId,
          taskTitle: task.title,
          userId: req.user!.id,
          workspaceId: task.project.workspaceId,
          commentContent: content!.substring(0, 100),
        });

        addBatchInvalidateCacheJob([
          { type: 'activity', taskId, userId: req.user!.id, workspaceId: task.project.workspaceId },
          { type: 'task', taskId, userId: req.user!.id, workspaceId: task.project.workspaceId },
        ]).catch(() => {});
      },
    );

    res.json({ success: true, message: "Comment deleted successfully" });
  },
);
