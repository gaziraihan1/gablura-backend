// src/tests/integration/announcement/announcement.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createProject,
  createAnnouncement,
} from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';
import { WorkspaceRole, AnnouncementVisibility } from '@prisma/client';

const wsAnnouncementsUrl = (wsId: string) =>
  `/api/workspaces/${wsId}/announcements`;

const projectAnnouncementsUrl = (wsId: string, pId: string) =>
  `/api/workspaces/${wsId}/projects/${pId}/announcements`;

const announcementUrl = (id: string) => 
  `/api/announcements/${id}`
// ─────────────────────────────────────────────────────────────
// cleanup (IMPORTANT for stability)
// ─────────────────────────────────────────────────────────────
beforeEach(async () => {
  process.env.ENFORCE_CSRF_IN_TESTS = 'true';
});
afterEach(async () => {
  await prisma.announcementTarget.deleteMany({});
  await prisma.announcement.deleteMany({});
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────
// POST workspace announcements
// ─────────────────────────────────────────────────────────────
describe('POST workspace announcements', () => {
  it('201 — OWNER creates a workspace announcement', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'Q2 Planning Update',
        content: 'We are kicking off Q2 planning next Monday.',
        visibility: AnnouncementVisibility.PUBLIC,
      });

    expect(res.status).toBe(201);

    const body = res.body.data;

    expect(body.title).toBe('Q2 Planning Update');
    expect(body.workspaceId).toBe(workspace.id);
    expect(body.isPinned).toBe(false);

    const db = await prisma.announcement.findUnique({
      where: { id: body.id },
    });

    expect(db?.createdById).toBe(user.id);
  });

  it('201 — ADMIN can create announcement', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(admin))
      .send({
        title: 'Admin Notice',
        content: 'Please review the new policy.',
      });

    expect(res.status).toBe(201);
  });

  it('403 — MEMBER cannot create workspace announcement', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(member))
      .send({
        title: 'Member Notice',
        content: 'Can I post this?',
      });

    expect(res.status).toBe(403);
  });

  it('403 — non-member cannot post', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(outsider))
      .send({ title: 'Sneaky', content: 'Hacking in.' });

    expect(res.status).toBe(403);
  });

  it('400 — missing title', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(user))
      .send({ content: 'Content without title' });

    expect(res.status).toBe(400);
  });

  it('400 — missing content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Title without content' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.id))
      .send({ title: 'No auth', content: 'Will fail' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET workspace announcements
// ─────────────────────────────────────────────────────────────
describe('GET workspace announcements', () => {
  it('200 — members see PUBLIC announcements', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createAnnouncement(workspace.id, user.id, {
      title: 'Public Notice',
    });

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.id))
      .set(authHeaders(member));

    expect(res.status).toBe(200);

    const list = res.body.data;

    expect(list.some((a: any) => a.title === 'Public Notice')).toBe(true);
  });

  it('200 — PRIVATE announcements hidden', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    await createAnnouncement(workspace.id, owner.id, {
      title: 'Secret Announcement',
      visibility: AnnouncementVisibility.PRIVATE,
    });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.id))
      .set(authHeaders(member));

    expect(res.status).toBe(200);

    const list = res.body.data;

    expect(
      list.some((a: any) => a.title === 'Secret Announcement'),
    ).toBe(false);
  });

  it('200 — workspace isolation', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { user: other, workspace: otherWs } =
      await createWorkspaceWithOwner();

    await createAnnouncement(workspace.id, user.id, {
      title: 'My WS Announcement',
    });

    await createAnnouncement(otherWs.id, other.id, {
      title: 'Other WS Announcement',
    });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.id))
      .set(authHeaders(user));

    const list = res.body.data;

    expect(
      list.every((a: any) => a.workspaceId === workspace.id),
    ).toBe(true);
  });

  it('403 — non-member cannot list', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.id))
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// PATCH announcement
// ─────────────────────────────────────────────────────────────
describe('PATCH announcement — pin/unpin', () => {
  it('200 — OWNER can pin', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.id, user.id);

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`) // ✅ FIXED
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const body = res.body.data;
    expect(body.isPinned).toBe(true);
  });

  it('403 — MEMBER cannot pin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.id, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`) // ✅ FIXED
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE announcement
// ─────────────────────────────────────────────────────────────
describe('DELETE workspace announcement', () => {
  it('200 — creator deletes', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.id, user.id);

    const res = await request(app)
      .delete(announcementUrl(ann.id)) // ✅ FIXED
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const db = await prisma.announcement.findUnique({
      where: { id: ann.id },
    });

    expect(db).toBeNull();
  });

  it('403 — MEMBER cannot delete', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.id, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .delete(announcementUrl(ann.id)) // ✅ FIXED
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// Project announcements
// ─────────────────────────────────────────────────────────────
describe('Project announcements', () => {
  it('200 — project GET scoped correctly', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    await createAnnouncement(workspace.id, user.id, {
      title: 'WS Level',
    });

    await createAnnouncement(workspace.id, user.id, {
      title: 'Project Level',
      projectId: project.id,
    });

    const res = await request(app)
      .get(projectAnnouncementsUrl(workspace.id, project.id))
      .set(authHeaders(user));


    const list = res.body.data;
    console.log(res.status, list)

    expect(list.every((a: any) => a.projectId === project.id)).toBe(true);
  });
});