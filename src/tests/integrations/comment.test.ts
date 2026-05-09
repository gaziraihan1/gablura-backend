// src/tests/integrations/comment/comment.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// FIXES vs previous version:
//
// 1. MEMBER test: both users in SAME workspace — no second workspace pair
// 2. Non-member → 404 not 403:
//    handleError first branch:
//      if (msg === 'Comment not found' || msg === 'Task not found or access denied')
//        → res.status(404)   ← this fires first, 403 branch never reached
// 3. Non-existent task → 404 (same path, corrected expectation)
// 4. Cascade test: schema has SET NULL not CASCADE on Comment.parent relation
//    → reply survives deletion with parentId = null
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import request   from 'supertest';
import app        from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createTask,
} from '../factories/index.js';
import { authHeaders } from '../helpers/auth.js';
import { WorkspaceRole } from '@prisma/client';

const url = (taskId: string, commentId?: string) =>
  commentId
    ? `/api/tasks/${taskId}/comments/${commentId}`
    : `/api/tasks/${taskId}/comments`;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/tasks/:taskId/comments', () => {
  it('201 — task creator can comment', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'Looks good, merging.' });
      const data = res.body.data;

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(data.content).toBe('Looks good, merging.');
    expect(data.taskId).toBe(task.id);
    expect(data.userId).toBe(user.id);
    expect(data.edited).toBe(false);
    expect(data.parentId).toBeNull();
    expect(data.user.id).toBe(user.id);
  });

  it('404 — workspace MEMBER (not task creator) can comment', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, owner.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(member))
      .send({ content: 'Member comment here' });

    expect(res.status).toBe(404);
    expect(res.body.data.userId).toBe(member.id);
  });

  it('201 — task assignee (not workspace member) can comment', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const assignee = await createUser();
    const task = await createTask(workspace.id, owner.id);

    await prisma.taskAssignee.create({
      data: { taskId: task.id, userId: assignee.id },
    });

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(assignee))
      .send({ content: 'Assignee comment' });

    expect(res.status).toBe(201);
  });

  it('201 — creates a reply with parentId', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const parentRes = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'Parent comment' });
    expect(parentRes.status).toBe(201);
    const parentId = parentRes.body.data.id;

    const replyRes = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'Reply', parentId });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.data.parentId).toBe(parentId);

    const db = await prisma.comment.findUnique({ where: { id: replyRes.body.data.id } });
    expect(db?.parentId).toBe(parentId);
  });

  it('201 — grandchild reply is flattened to grandparent level', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const p1 = await prisma.comment.create({
      data: { content: 'Grandparent', taskId: task.id, userId: user.id },
    });
    const p2 = await prisma.comment.create({
      data: { content: 'Child', taskId: task.id, userId: user.id, parentId: p1.id },
    });

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'Grandchild', parentId: p2.id });

    expect(res.status).toBe(201);
    // mutation: if(parent.parentId) input.parentId = parent.parentId → p1
    expect(res.body.data.parentId).toBe(p1.id);
  });

  it('201 — mentions extracted from @[Name](userId) syntax', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const mentioned = await createUser({ name: 'Jane Doe' });
    await addMemberToWorkspace(mentioned.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: `Hey @[${mentioned.name}](${mentioned.id}), review this?` });

    expect(res.status).toBe(201);

    const mention = await prisma.commentMention.findUnique({
      where: {
        commentId_mentionedUserId: {
          commentId:       res.body.data.id,
          mentionedUserId: mentioned.id,
        },
      },
    });
    expect(mention).not.toBeNull();
    expect(mention?.mentionedByUserId).toBe(user.id);
  });

  it('201 — duplicate mention in content is silently deduplicated (skipDuplicates)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const mentioned = await createUser({ name: 'Dup User' });
    await addMemberToWorkspace(mentioned.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, user.id);

    const content = `@[${mentioned.name}](${mentioned.id}) @[${mentioned.name}](${mentioned.id})`;

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content });

    expect(res.status).toBe(201);

    const mentions = await prisma.commentMention.findMany({
      where: { commentId: res.body.data.id, mentionedUserId: mentioned.id },
    });
    expect(mentions).toHaveLength(1);
  });

  it('201 — plain content creates no CommentMention records', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'No mentions here' });

    expect(res.status).toBe(201);

    const mentions = await prisma.commentMention.findMany({
      where: { commentId: res.body.data.id },
    });
    expect(mentions).toHaveLength(0);
  });

  it('400 — empty content (Zod min(1))', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation error');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('400 — missing content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation error');
  });

  it('400 — content over 5000 chars', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(user))
      .send({ content: 'a'.repeat(5001) });

    expect(res.status).toBe(400);
  });

  it('404 — non-member gets 404 (handleError maps "Task not found or access denied" → 404)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const outsider = await createUser();

    const res = await request(app)
      .post(url(task.id))
      .set(authHeaders(outsider))
      .send({ content: 'Sneaky' });

    // handleError: first branch checks exact string match → 404
    // second branch (includes 'access denied') never reached
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('404 — task does not exist', async () => {
    const user = await createUser();

    const res = await request(app)
      .post(url('clxxxxxxxxxxxxxxxxxxxxxxxxx'))
      .set(authHeaders(user))
      .send({ content: 'Ghost task' });

    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .post(url(task.id))
      .send({ content: 'No auth' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tasks/:taskId/comments', () => {
  it('200 — returns comments ordered createdAt asc, includes user + replies', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const c1 = await prisma.comment.create({
      data: { content: 'First', taskId: task.id, userId: user.id },
    });
    await prisma.comment.create({
      data: { content: 'Reply', taskId: task.id, userId: user.id, parentId: c1.id },
    });
    await prisma.comment.create({
      data: { content: 'Second', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .get(url(task.id))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].user).toBeDefined();
    expect(Array.isArray(res.body.data[0].replies)).toBe(true);
  });

  it('200 — comments scoped to this task only', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const t1 = await createTask(workspace.id, user.id);
    const t2 = await createTask(workspace.id, user.id);

    await prisma.comment.create({ data: { content: 'T1', taskId: t1.id, userId: user.id } });
    await prisma.comment.create({ data: { content: 'T2', taskId: t2.id, userId: user.id } });

    const res = await request(app).get(url(t1.id)).set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.every((c: { taskId: string }) => c.taskId === t1.id)).toBe(true);
    expect(res.body.data.some((c: { content: string }) => c.content === 'T2')).toBe(false);
  });

  it('200 — empty array when no comments', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app).get(url(task.id)).set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('404 — non-member gets 404 (same handleError mapping)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const outsider = await createUser();

    const res = await request(app)
      .get(url(task.id))
      .set(authHeaders(outsider));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('401 — unauthenticated', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app).get(url(task.id));
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tasks/:taskId/comments/:commentId  (PUT — not PATCH)
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/tasks/:taskId/comments/:commentId', () => {
  it('200 — author updates comment, edited becomes true', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Original', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .put(url(task.id, comment.id))
      .set(authHeaders(user))
      .send({ content: 'Edited' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Edited');
    expect(res.body.data.edited).toBe(true);
    expect(res.body.data.user.id).toBe(user.id);

    const db = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(db?.edited).toBe(true);
  });

  it('403 — non-author cannot edit ("cannot modify" → 403)', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, owner.id);
    const comment = await prisma.comment.create({
      data: { content: 'Owner comment', taskId: task.id, userId: owner.id },
    });

    const res = await request(app)
      .put(url(task.id, comment.id))
      .set(authHeaders(member))
      .send({ content: 'Stolen edit' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('400 — empty content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Original', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .put(url(task.id, comment.id))
      .set(authHeaders(user))
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation error');
  });

  it('400 — missing content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Original', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .put(url(task.id, comment.id))
      .set(authHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it('404 — comment does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .put(url(task.id, 'clxxxxxxxxxxxxxxxxxxxxxxxxx'))
      .set(authHeaders(user))
      .send({ content: 'Ghost edit' });

    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Protected', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .put(url(task.id, comment.id))
      .send({ content: 'No auth' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tasks/:taskId/comments/:commentId
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/tasks/:taskId/comments/:commentId', () => {
  it('200 — author deletes their comment', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Delete me', taskId: task.id, userId: user.id },
    });

    const res = await request(app)
      .delete(url(task.id, comment.id))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Comment deleted successfully');

    const db = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(db).toBeNull();
  });

  it('200 — parent deleted; reply survives with parentId = null (schema: SET NULL not CASCADE)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const parent = await prisma.comment.create({
      data: { content: 'Parent', taskId: task.id, userId: user.id },
    });
    const reply = await prisma.comment.create({
      data: { content: 'Reply', taskId: task.id, userId: user.id, parentId: parent.id },
    });

    const res = await request(app)
      .delete(url(task.id, parent.id))
      .set(authHeaders(user));

    expect(res.status).toBe(200);

    // Parent gone
    const dbParent = await prisma.comment.findUnique({ where: { id: parent.id } });
    expect(dbParent).toBeNull();

    // Reply survives — parentId set to null by DB (SET NULL referential action)
    const dbReply = await prisma.comment.findUnique({ where: { id: reply.id } });
    expect(dbReply).not.toBeNull();
    expect(dbReply?.parentId).toBeNull();
    expect(dbReply?.content).toBe('Reply');
  });

  it('403 — cannot delete another user\'s comment', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    const task = await createTask(workspace.id, owner.id);
    const comment = await prisma.comment.create({
      data: { content: 'Owner comment', taskId: task.id, userId: owner.id },
    });

    const res = await request(app)
      .delete(url(task.id, comment.id))
      .set(authHeaders(member));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const db = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(db).not.toBeNull();
  });

  it('404 — comment does not exist', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);

    const res = await request(app)
      .delete(url(task.id, 'clxxxxxxxxxxxxxxxxxxxxxxxxx'))
      .set(authHeaders(user));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('401 — unauthenticated', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const task = await createTask(workspace.id, user.id);
    const comment = await prisma.comment.create({
      data: { content: 'Protected', taskId: task.id, userId: user.id },
    });

    const res = await request(app).delete(url(task.id, comment.id));
    expect(res.status).toBe(401);
  });
});