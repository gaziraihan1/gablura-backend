// src/tests/unit/comment/comment.utils.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests for mention/mention.utils.ts — no mocks, no DB.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  extractMentionedUserIds,
  stripMentionSyntax,
} from '../../../modules/comment/mention/mention.utils.js';

describe('extractMentionedUserIds', () => {
  it('extracts a single user id from mention syntax', () => {
    const ids = extractMentionedUserIds('Hey @[Jane](user-123), look at this');
    expect(ids).toEqual(['user-123']);
  });

  it('extracts multiple distinct user ids', () => {
    const ids = extractMentionedUserIds(
      '@[Alice](uid-1) and @[Bob](uid-2) please review',
    );
    expect(ids).toContain('uid-1');
    expect(ids).toContain('uid-2');
    expect(ids).toHaveLength(2);
  });

  it('deduplicates the same user mentioned twice', () => {
    const ids = extractMentionedUserIds(
      '@[Jane](user-123) can you check? @[Jane](user-123)',
    );
    expect(ids).toEqual(['user-123']);
  });

  it('returns an empty array when content has no mentions', () => {
    expect(extractMentionedUserIds('No mentions here')).toEqual([]);
  });

  it('returns an empty array for empty string', () => {
    expect(extractMentionedUserIds('')).toEqual([]);
  });

  it('ignores malformed mention-like strings without proper syntax', () => {
    expect(extractMentionedUserIds('@Jane plain at-mention')).toEqual([]);
    expect(extractMentionedUserIds('@[Jane] missing-parens')).toEqual([]);
  });

  it('handles mixed valid and invalid mention syntax', () => {
    const ids = extractMentionedUserIds('@[Valid](uid-42) @[Invalid]');
    expect(ids).toEqual(['uid-42']);
  });

  it('extracts cuid-style user ids correctly', () => {
    const cuid = 'clabcdef1234567890abcdef';
    const ids  = extractMentionedUserIds(`@[Team Lead](${cuid})`);
    expect(ids).toEqual([cuid]);
  });
});

describe('stripMentionSyntax', () => {
  it('converts @[Name](id) to @Name', () => {
    expect(stripMentionSyntax('@[Jane Doe](user-123)')).toBe('@Jane Doe');
  });

  it('strips multiple mentions', () => {
    const result = stripMentionSyntax('@[Alice](u1) and @[Bob](u2)');
    expect(result).toBe('@Alice and @Bob');
  });

  it('leaves plain text unchanged', () => {
    expect(stripMentionSyntax('No mentions here')).toBe('No mentions here');
  });

  it('returns empty string for empty input', () => {
    expect(stripMentionSyntax('')).toBe('');
  });

  it('strips mention but preserves surrounding punctuation', () => {
    const result = stripMentionSyntax('Hi @[Jane](u1), how are you?');
    expect(result).toBe('Hi @Jane, how are you?');
  });

  it('handles multi-word display names', () => {
    expect(stripMentionSyntax('@[John Smith Jr](u99)')).toBe('@John Smith Jr');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// src/tests/unit/comment/comment.access.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for CommentAccess — real DB (test instance).
// ─────────────────────────────────────────────────────────────────────────────

import { vi as _vi, describe as _describe, it as _it, expect as _expect, beforeEach as _beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { CommentAccess } from '../../../modules/comment/comment.access.js';
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createTask,
  assignUserToTask,
} from '../../factories/index.js';
import { WorkspaceRole } from '@prisma/client';

_describe('CommentAccess.assertTaskAccess', () => {
  _it('allows the task creator', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await _expect(
      CommentAccess.assertTaskAccess(task.id, user.id),
    ).resolves.not.toThrow();
  });

  _it('allows a task assignee', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const assignee = await createUser();
    const task = await createTask(workspace.id, owner.id);
    await assignUserToTask(task.id, assignee.id);

    await _expect(
      CommentAccess.assertTaskAccess(task.id, assignee.id),
    ).resolves.not.toThrow();
  });

  _it('allows a workspace ADMIN', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const { user: other } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, other.id);

    await _expect(
      CommentAccess.assertTaskAccess(task.id, admin.id),
    ).resolves.not.toThrow();
  });

  _it('throws TASK_NOT_FOUND for a non-member with no task relationship', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();
    const task = await createTask(workspace.id, owner.id);

    await _expect(
      CommentAccess.assertTaskAccess(task.id, outsider.id),
    ).rejects.toThrow('Task not found');
  });

  _it('throws Task not found for a non-existent task id', async () => {
    const user = await createUser();

    await _expect(
      CommentAccess.assertTaskAccess('non-existent-task-id', user.id),
    ).rejects.toThrow('Task not found');
  });

  _it('returns the task record on success', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const result = await CommentAccess.assertTaskAccess(task.id, user.id);
    _expect(result.id).toBe(task.id);
  });
});

_describe('CommentAccess.assertCommentOwnership', () => {
  _it('allows the comment author to proceed', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'My comment', taskId: task.id, userId: user.id },
    });

    await _expect(
      CommentAccess.assertCommentOwnership(comment.id, task.id, user.id),
    ).resolves.not.toThrow();
  });

  _it('throws ForbiddenError when user is not the comment author', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const intruder = await createUser();
    const task = await createTask(workspace.id, owner.id);
    const comment = await prisma.comment.create({
      data: { content: 'Owner comment', taskId: task.id, userId: owner.id },
    });

    await _expect(
      CommentAccess.assertCommentOwnership(comment.id, task.id, intruder.id),
    ).rejects.toThrow('You cannot modify this comment');
  });

  _it('throws NotFoundError when the comment does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    await _expect(
      CommentAccess.assertCommentOwnership('non-existent-comment', task.id, user.id),
    ).rejects.toThrow();
  });

  _it('throws NotFoundError when commentId belongs to a different taskId', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task1 = await createTask(workspace.id, user.id);
    const task2 = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'On task 1', taskId: task1.id, userId: user.id },
    });

    // Passing task2.id when comment belongs to task1 → findFirst returns null
    await _expect(
      CommentAccess.assertCommentOwnership(comment.id, task2.id, user.id),
    ).rejects.toThrow();
  });

  _it('returns the comment record on success', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Check me', taskId: task.id, userId: user.id },
    });

    const result = await CommentAccess.assertCommentOwnership(comment.id, task.id, user.id);
    _expect(result.id).toBe(comment.id);
    _expect(result.content).toBe('Check me');
  });
});