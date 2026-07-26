import { prisma } from '../../lib/prisma.js';
import type { CreateCommentInput, UpdateCommentInput } from './comment.types.js';
import { commentSimpleInclude } from './comment.selects.js';
import { CommentAccess } from './comment.access.js';
import { extractMentionedUserIds } from './mention/mention.utils.js';
import { BadRequestError } from '../../errors/index.js';

type OnCommentCreated = (data: {
  commentId:    string;
  content:      string;
  parentId:     string | null;
  mentionedIds: string[];
}) => Promise<void>;

type OnCommentMutated = (data: {
  oldContent?: string;
  newContent?: string;
  content?:    string;
}) => Promise<void>;

export const CommentMutation = {
  async createComment(input: CreateCommentInput, onCreated?: OnCommentCreated) {
    // Access check + parent validation in PARALLEL — eliminates serial round-trip
    const [, parentComment] = await Promise.all([
      CommentAccess.assertTaskAccess(input.taskId, input.userId),
      input.parentId
        ? prisma.comment.findUnique({
            where:  { id: input.parentId },
            select: { taskId: true, parentId: true },
          })
        : Promise.resolve(null),
    ]);

    // Flatten nested replies to max 1 level deep
    let resolvedParentId = input.parentId ?? null;
    if (parentComment) {
      if (parentComment.taskId !== input.taskId) {
        throw new BadRequestError('Invalid parent comment');
      }
      resolvedParentId = parentComment.parentId ?? input.parentId ?? null;
    }

    const mentionedIds = extractMentionedUserIds(input.content);

    // Create comment + mentions atomically
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          content:  input.content,
          taskId:   input.taskId,
          userId:   input.userId,
          parentId: resolvedParentId,
        },
        include: commentSimpleInclude,
      });

      if (mentionedIds.length > 0) {
        await tx.commentMention.createMany({
          data: mentionedIds.map((mentionedUserId) => ({
            commentId:         created.id,
            mentionedUserId,
            mentionedByUserId: input.userId,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    if (onCreated) {
      await Promise.allSettled([
        onCreated({
          commentId: comment.id,
          content: input.content,
          parentId: resolvedParentId,
          mentionedIds,
        }),
      ]);
    }

return comment;
  },

  async updateComment(
    commentId: string,
    taskId:    string,
    userId:    string,
    input:     UpdateCommentInput,
    onUpdated?: OnCommentMutated,
  ) {
    const comment = await CommentAccess.assertCommentOwnership(commentId, taskId, userId);

    const updated = await prisma.comment.update({
      where:   { id: commentId },
      data:    { content: input.content, edited: true },
      include: commentSimpleInclude,
    });

    if (onUpdated) {
      onUpdated({
        oldContent: comment.content,
        newContent: input.content,
      }).catch((err) => console.error('Post-comment-update callback failed:', err));
    }

    return updated;
  },

  async deleteComment(
    commentId: string,
    taskId:    string,
    userId:    string,
    onDeleted?: OnCommentMutated,
  ): Promise<void> {
    const comment = await CommentAccess.assertCommentOwnership(commentId, taskId, userId);

    await prisma.comment.delete({ where: { id: commentId } });

    if (onDeleted) {
      onDeleted({ content: comment.content })
        .catch((err) => console.error('Post-comment-deletion callback failed:', err));
    }
  },
};