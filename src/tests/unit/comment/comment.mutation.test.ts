// src/tests/unit/comment/comment.mutation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for CommentMutation — all external I/O is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Prisma ────────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    comment: {
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
    },
    commentMention: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
import { prisma } from '../../../lib/prisma.js';

// ── Access ────────────────────────────────────────────────────────────────────
vi.mock('../../../modules/comment/comment.access.js', () => ({
  CommentAccess: {
    assertTaskAccess:       vi.fn(),
    assertCommentOwnership: vi.fn(),
  },
}));
import { CommentAccess } from '../../../modules/comment/comment.access.js';

// ── Mention utils ─────────────────────────────────────────────────────────────
vi.mock('../../../modules/comment/mention/mention.utils.js', () => ({
  extractMentionedUserIds: vi.fn(() => []),
}));
import { extractMentionedUserIds } from '../../../modules/comment/mention/mention.utils.js';

import { CommentMutation } from '../../../modules/comment/comment.mutation.js';
import { TaskCache, ActivityCache } from '../../../lib/redis/cache.client.js';

// ── Cache invalidation ────────────────────────────────────────────────────────
vi.mock('../../../lib/redis/cache.client.js', () => ({
  TaskCache: { invalidateTask: vi.fn() },
  ActivityCache: { invalidateTaskActivities: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTxMock(commentOverride?: Partial<{ id: string; content: string }>) {
  const created = { id: 'c1', content: 'hello', ...commentOverride };
  return (fn: any) =>
    fn({
      comment:        { create: vi.fn().mockResolvedValue(created) },
      commentMention: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
}

const BASE_INPUT = { taskId: 't1', userId: 'u1', content: 'hello', parentId: null };

// ─────────────────────────────────────────────────────────────────────────────
// createComment
// ─────────────────────────────────────────────────────────────────────────────

describe('CommentMutation.createComment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a comment and returns it', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (prisma.$transaction as any).mockImplementation(makeTxMock());

    const result = await CommentMutation.createComment(BASE_INPUT);

    expect(result.id).toBe('c1');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(TaskCache.invalidateTask).toHaveBeenCalledWith('t1');
    expect(ActivityCache.invalidateTaskActivities).toHaveBeenCalledWith('t1');
  });

  it('calls assertTaskAccess with the correct taskId and userId', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (prisma.$transaction as any).mockImplementation(makeTxMock());

    await CommentMutation.createComment(BASE_INPUT);

    expect(CommentAccess.assertTaskAccess).toHaveBeenCalledWith('t1', 'u1');
  });

  it('throws when assertTaskAccess rejects (access denied)', async () => {
    (CommentAccess.assertTaskAccess as any).mockRejectedValue(new Error('TASK_NOT_FOUND'));

    await expect(CommentMutation.createComment(BASE_INPUT)).rejects.toThrow('TASK_NOT_FOUND');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when parent comment belongs to a different task', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (prisma.comment.findUnique as any).mockResolvedValue({
      taskId:   'different-task',
      parentId: null,
    });

    await expect(
      CommentMutation.createComment({ ...BASE_INPUT, parentId: 'p1' }),
    ).rejects.toThrow('Invalid parent comment');
  });

  it('throws BAD_REQUEST when parent comment does not exist (e.g. stale/optimistic id)', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (prisma.comment.findUnique as any).mockResolvedValue(null);

    await expect(
      CommentMutation.createComment({ ...BASE_INPUT, parentId: 'optimistic-comment-123' }),
    ).rejects.toThrow('Invalid parent comment');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('flattens a grandchild reply to grandparent level (max 1 level deep)', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    // Parent comment itself has a parentId → grandparent scenario
    (prisma.comment.findUnique as any).mockResolvedValue({
      taskId:   't1',
      parentId: 'grandparent-id',
    });

    let capturedParentId: string | null = null;
    (prisma.$transaction as any).mockImplementation((fn: any) =>
      fn({
        comment: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            capturedParentId = data.parentId;
            return { id: 'c-new', content: 'grandchild' };
          }),
        },
        commentMention: { createMany: vi.fn() },
      }),
    );

    await CommentMutation.createComment({ ...BASE_INPUT, parentId: 'child-id' });

    expect(capturedParentId).toBe('grandparent-id');
  });

  it('calls createMany for mentions when content has @mentions', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (extractMentionedUserIds as any).mockReturnValue(['mentioned-user']);

    let capturedCreateMany: any;
    (prisma.$transaction as any).mockImplementation((fn: any) =>
      fn({
        comment: { create: vi.fn().mockResolvedValue({ id: 'c1', content: '@[Jane](mentioned-user)' }) },
        commentMention: {
          createMany: vi.fn().mockImplementation((args: any) => {
            capturedCreateMany = args;
            return { count: 1 };
          }),
        },
      }),
    );

    await CommentMutation.createComment({ ...BASE_INPUT, content: '@[Jane](mentioned-user)' });

    expect(capturedCreateMany.data[0].mentionedUserId).toBe('mentioned-user');
    expect(capturedCreateMany.data[0].mentionedByUserId).toBe('u1');
    expect(capturedCreateMany.skipDuplicates).toBe(true);
  });

  it('skips createMany when content has no mentions', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (extractMentionedUserIds as any).mockReturnValue([]);

    let createManyCalled = false;
    (prisma.$transaction as any).mockImplementation((fn: any) =>
      fn({
        comment: { create: vi.fn().mockResolvedValue({ id: 'c1', content: 'plain' }) },
        commentMention: {
          createMany: vi.fn().mockImplementation(() => { createManyCalled = true; }),
        },
      }),
    );

    await CommentMutation.createComment(BASE_INPUT);

    expect(createManyCalled).toBe(false);
  });

  it('calls onCreated callback with correct payload', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (extractMentionedUserIds as any).mockReturnValue(['u2']);
    (prisma.$transaction as any).mockImplementation(makeTxMock());

    const cb = vi.fn().mockResolvedValue(undefined);
    await CommentMutation.createComment({ ...BASE_INPUT, parentId: null }, cb);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId:    'c1',
        content:      'hello',
        parentId:     null,
        mentionedIds: ['u2'],
      }),
    );
  });

  it('does not throw if onCreated callback rejects (fire-and-forget)', async () => {
    (CommentAccess.assertTaskAccess as any).mockResolvedValue(true);
    (prisma.$transaction as any).mockImplementation(makeTxMock());

    const cb = vi.fn().mockRejectedValue(new Error('cb failure'));

    await expect(
      CommentMutation.createComment(BASE_INPUT, cb),
    ).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateComment
// ─────────────────────────────────────────────────────────────────────────────

describe('CommentMutation.updateComment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the comment content and sets edited: true', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'old' });
    (prisma.comment.update as any).mockResolvedValue({ id: 'c1', content: 'new', edited: true });

    const result = await CommentMutation.updateComment('c1', 't1', 'u1', { content: 'new' });

    expect(result.content).toBe('new');
    expect(result.edited).toBe(true);
    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { content: 'new', edited: true } }),
    );
    expect(TaskCache.invalidateTask).toHaveBeenCalledWith('t1');
    expect(ActivityCache.invalidateTaskActivities).toHaveBeenCalledWith('t1');
  });

  it('calls assertCommentOwnership with correct args', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'old' });
    (prisma.comment.update as any).mockResolvedValue({ id: 'c1', content: 'new', edited: true });

    await CommentMutation.updateComment('c1', 't1', 'u1', { content: 'new' });

    expect(CommentAccess.assertCommentOwnership).toHaveBeenCalledWith('c1', 't1', 'u1');
  });

  it('throws when assertCommentOwnership rejects (not owner)', async () => {
    (CommentAccess.assertCommentOwnership as any).mockRejectedValue(
      new Error('You cannot modify this comment'),
    );

    await expect(
      CommentMutation.updateComment('c1', 't1', 'other-user', { content: 'new' }),
    ).rejects.toThrow('You cannot modify this comment');

    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('calls onUpdated callback with old and new content', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'old content' });
    (prisma.comment.update as any).mockResolvedValue({ id: 'c1', content: 'new content', edited: true });

    const cb = vi.fn().mockResolvedValue(undefined);
    await CommentMutation.updateComment('c1', 't1', 'u1', { content: 'new content' }, cb);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ oldContent: 'old content', newContent: 'new content' }),
    );
  });

  it('does not throw if onUpdated callback rejects (fire-and-forget)', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'old' });
    (prisma.comment.update as any).mockResolvedValue({ id: 'c1', content: 'new', edited: true });

    const cb = vi.fn().mockRejectedValue(new Error('cb failure'));

    await expect(
      CommentMutation.updateComment('c1', 't1', 'u1', { content: 'new' }, cb),
    ).resolves.not.toThrow();
  });

  it('throws when comment does not exist', async () => {
    (CommentAccess.assertCommentOwnership as any).mockRejectedValue(new Error('Comment not found'));

    await expect(
      CommentMutation.updateComment('ghost', 't1', 'u1', { content: 'new' }),
    ).rejects.toThrow('Comment not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteComment
// ─────────────────────────────────────────────────────────────────────────────

describe('CommentMutation.deleteComment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the comment by id', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'bye' });
    (prisma.comment.delete as any).mockResolvedValue({});

    await CommentMutation.deleteComment('c1', 't1', 'u1');

    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(TaskCache.invalidateTask).toHaveBeenCalledWith('t1');
    expect(ActivityCache.invalidateTaskActivities).toHaveBeenCalledWith('t1');
  });

  it('throws when assertCommentOwnership rejects (not owner)', async () => {
    (CommentAccess.assertCommentOwnership as any).mockRejectedValue(
      new Error('You cannot modify this comment'),
    );

    await expect(
      CommentMutation.deleteComment('c1', 't1', 'intruder'),
    ).rejects.toThrow('You cannot modify this comment');

    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });

  it('throws when comment does not exist', async () => {
    (CommentAccess.assertCommentOwnership as any).mockRejectedValue(new Error('Comment not found'));

    await expect(
      CommentMutation.deleteComment('ghost', 't1', 'u1'),
    ).rejects.toThrow('Comment not found');
  });

  it('calls onDeleted callback with comment content', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'old text' });
    (prisma.comment.delete as any).mockResolvedValue({});

    const cb = vi.fn().mockResolvedValue(undefined);
    await CommentMutation.deleteComment('c1', 't1', 'u1', cb);

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'old text' }),
    );
  });

  it('does not throw if onDeleted callback rejects (fire-and-forget)', async () => {
    (CommentAccess.assertCommentOwnership as any).mockResolvedValue({ id: 'c1', content: 'text' });
    (prisma.comment.delete as any).mockResolvedValue({});

    const cb = vi.fn().mockRejectedValue(new Error('cb failure'));

    await expect(
      CommentMutation.deleteComment('c1', 't1', 'u1', cb),
    ).resolves.not.toThrow();
  });
});