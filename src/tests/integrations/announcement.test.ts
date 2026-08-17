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

// ─────────────────────────────────────────────────────────────────────────────
// URL builders
// ─────────────────────────────────────────────────────────────────────────────

const wsAnnouncementsUrl = (wsSlug: string) =>
  `/api/v1/workspaces/${wsSlug}/announcements`;

const projectAnnouncementsUrl = (wsSlug: string, projectId: string) =>
  `/api/v1/workspaces/${wsSlug}/projects/${projectId}/announcements`;

const announcementUrl = (id: string) =>
  `/api/v1/announcements/${id}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Adds a user to a project as MANAGER (satisfies canManageProjectAnnouncements) */
async function addProjectManager(projectId: string, userId: string) {
  return prisma.projectMember.create({
    data: { projectId, userId, role: 'MANAGER' },
  });
}

/** Adds a user to a project as a regular MEMBER */
// async function addProjectMember(projectId: string, userId: string) {
//   return prisma.projectMember.create({
//     data: { projectId, userId, role: 'COLLABORATOR' },
//   });
// }

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = 'true';
});

afterEach(async () => {
  await prisma.announcementTarget.deleteMany({});
  await prisma.announcement.deleteMany({});
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /workspaces/:slug/announcements
// ─────────────────────────────────────────────────────────────────────────────

describe('POST workspace announcements', () => {
  it('201 — OWNER creates a PUBLIC workspace announcement', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'Q2 Planning Update',
        content: 'We are kicking off Q2 planning next Monday.',
        visibility: AnnouncementVisibility.PUBLIC,
      });

    expect(res.status).toBe(201);

    const body = res.body.data;
    expect(body.title).toBe('Q2 Planning Update');
    expect(body.workspaceSlug).toBe(workspace.slug);
    expect(body.isPinned).toBe(false);
    expect(body.visibility).toBe('PUBLIC');

    const db = await prisma.announcement.findUnique({ where: { id: body.id } });
    expect(db?.createdById).toBe(user.id);
  });

  it('201 — ADMIN can create a workspace announcement', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(admin))
      .send({ title: 'Admin Notice', content: 'Please review the new policy.' });

    expect(res.status).toBe(201);
  });

  it('201 — creates with isPinned: true', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Pinned Notice', content: 'Very important.', isPinned: true });

    expect(res.status).toBe(201);
    expect(res.body.data.isPinned).toBe(true);
  });

  it('201 — PRIVATE announcement with valid workspace-member targets', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const target = await createUser();
    await addMemberToWorkspace(target.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'Private Notice',
        content: 'Only for you.',
        visibility: 'PRIVATE',
        targetIds: [target.id],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.visibility).toBe('PRIVATE');

    const db = await prisma.announcementTarget.findFirst({
      where: { announcementId: res.body.data.id },
    });
    expect(db?.userId).toBe(target.id);
  });

  it('400 — PRIVATE announcement with no targetIds', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Secret', content: 'Nobody targeted.', visibility: 'PRIVATE' });

    expect(res.status).toBe(400);
  });

  it('400 — PRIVATE announcement targeting a non-member', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'Secret',
        content: 'Targeting outsider.',
        visibility: 'PRIVATE',
        targetIds: [outsider.id],
      });

    expect(res.status).toBe(400);
  });

  it('403 — MEMBER cannot create a workspace announcement', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(member))
      .send({ title: 'Member Notice', content: 'Can I post this?' });

    expect(res.status).toBe(403);
  });

  it('403 — non-member cannot create', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(outsider))
      .send({ title: 'Sneaky', content: 'Hacking in.' });

    expect(res.status).toBe(403);
  });

  it('400 — missing title', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({ content: 'Content without title' });

    expect(res.status).toBe(400);
  });

  it('400 — missing content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Title without content' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated request', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .send({ title: 'No auth', content: 'Will fail' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspaces/:slug/announcements
// ─────────────────────────────────────────────────────────────────────────────

describe('GET workspace announcements', () => {
  it('200 — members can see PUBLIC announcements', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createAnnouncement(workspace.slug, user.id, { title: 'Public Notice' });

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: any) => a.title === 'Public Notice')).toBe(true);
  });

  it('200 — PRIVATE announcements are hidden from non-targets', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    await createAnnouncement(workspace.slug, owner.id, {
      title: 'Secret Announcement',
      visibility: AnnouncementVisibility.PRIVATE,
    });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(member));

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: any) => a.title === 'Secret Announcement')).toBe(false);
  });

  it('200 — creator can see their own PRIVATE announcement', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    // Use HTTP so the targetIds path is exercised; owner IS the creator
    // We need at least one target for the service to accept it — use a member
    const target = await createUser();
    await addMemberToWorkspace(target.id, workspace.id, WorkspaceRole.MEMBER);

    await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'My Private Post',
        content: 'Only creator and target see this.',
        visibility: 'PRIVATE',
        targetIds: [target.id],
      });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: any) => a.title === 'My Private Post')).toBe(true);
  });

  it('200 — response includes pagination metadata', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createAnnouncement(workspace.slug, user.id);

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({
      page:       expect.any(Number),
      pageSize:   expect.any(Number),
      totalCount: expect.any(Number),
      totalPages: expect.any(Number),
      hasNext:    expect.any(Boolean),
      hasPrev:    expect.any(Boolean),
    });
  });

  it('200 — pinned announcements appear first', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    await createAnnouncement(workspace.slug, user.id, { title: 'Normal', isPinned: false });
    await createAnnouncement(workspace.slug, user.id, { title: 'Pinned', isPinned: true });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('Pinned');
  });

  it('200 — workspace isolation: only returns announcements for requested workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { user: other, workspace: otherWs } = await createWorkspaceWithOwner();

    await createAnnouncement(workspace.slug, user.id, { title: 'My WS Announcement' });
    await createAnnouncement(otherWs.slug, other.id, { title: 'Other WS Announcement' });

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: any) => a.workspaceSlug === workspace.slug)).toBe(true);
  });

  it('403 — non-member cannot list', async () => {
    const { workspace } = await createWorkspaceWithOwner();
    const outsider = await createUser();

    const res = await request(app)
      .get(wsAnnouncementsUrl(workspace.slug))
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it('401 — unauthenticated cannot list', async () => {
    const { workspace } = await createWorkspaceWithOwner();

    const res = await request(app).get(wsAnnouncementsUrl(workspace.slug));

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /announcements/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /announcements/:id (single)', () => {
  it('200 — member can fetch a PUBLIC announcement by id', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id, { title: 'Single Fetch' });

    const res = await request(app)
      .get(announcementUrl(ann.id))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ann.id);
    expect(res.body.data.title).toBe('Single Fetch');
  });

  it('403 — non-target cannot fetch a PRIVATE announcement', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const target = await createUser();
    await addMemberToWorkspace(target.id, workspace.id, WorkspaceRole.MEMBER);
    const outsider = await createUser();
    await addMemberToWorkspace(outsider.id, workspace.id, WorkspaceRole.MEMBER);

    // Create private announcement via HTTP (requires target)
    const createRes = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(owner))
      .send({
        title: 'Private Only',
        content: 'Secret.',
        visibility: 'PRIVATE',
        targetIds: [target.id],
      });
    expect(createRes.status).toBe(201);

    const res = await request(app)
      .get(announcementUrl(createRes.body.data.id))
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });

  it('404 — non-existent announcement id', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(announcementUrl('non-existent-id'))
      .set(authHeaders(user));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /announcements/:id/pin
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH announcement — pin/unpin', () => {
  it('200 — OWNER can pin an announcement', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id, { isPinned: false });

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.isPinned).toBe(true);
  });

  it('200 — toggles: pinned → unpinned', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id, { isPinned: true });

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.isPinned).toBe(false);
  });

  it('200 — ADMIN can pin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`)
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
  });

  it('403 — MEMBER cannot pin', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .patch(`${announcementUrl(ann.id)}/pin`)
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });

  it('404 — non-existent announcement', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .patch(`${announcementUrl('non-existent-id')}/pin`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /announcements/:id (update)
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH announcement — update', () => {
  it('200 — OWNER updates title and content', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id, {
      title: 'Original',
      content: 'Original content',
    });

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Updated Title', content: 'Updated content' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Title');
    expect(res.body.data.content).toBe('Updated content');
  });

  it('200 — ADMIN can update any workspace announcement', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(admin))
      .send({ title: 'By Admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('By Admin');
  });

  it('200 — ADMIN updates pinned state', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, owner.id, { isPinned: false });

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(owner))
      .send({ isPinned: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isPinned).toBe(true);
  });

  it('200 — replaces PRIVATE targets when new targetIds provided', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const memberA = await createUser();
    const memberB = await createUser();
    await addMemberToWorkspace(memberA.id, workspace.id, WorkspaceRole.MEMBER);
    await addMemberToWorkspace(memberB.id, workspace.id, WorkspaceRole.MEMBER);

    const ann = await createAnnouncement(workspace.slug, owner.id, {
      visibility: AnnouncementVisibility.PRIVATE,
    });
    await prisma.announcementTarget.createMany({
      data: [{ announcementId: ann.id, userId: memberA.id }],
    });

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(owner))
      .send({
        visibility: AnnouncementVisibility.PRIVATE,
        targetIds: [memberB.id],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.targets.map((t: any) => t.userId)).toEqual([memberB.id]);
  });

  it('200 — switching to PUBLIC clears targets', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const memberA = await createUser();
    await addMemberToWorkspace(memberA.id, workspace.id, WorkspaceRole.MEMBER);

    const ann = await createAnnouncement(workspace.slug, owner.id, {
      visibility: AnnouncementVisibility.PRIVATE,
    });
    await prisma.announcementTarget.createMany({
      data: [{ announcementId: ann.id, userId: memberA.id }],
    });

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(owner))
      .send({ visibility: AnnouncementVisibility.PUBLIC });

    expect(res.status).toBe(200);
    expect(res.body.data.visibility).toBe('PUBLIC');

    const db = await prisma.announcement.findUnique({
      where: { id: ann.id },
      include: { targets: true },
    });
    expect(db?.targets.length ?? 0).toBe(0);
  });

  it('400 — PRIVATE update with no targets', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id);

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(user))
      .send({ visibility: AnnouncementVisibility.PRIVATE });

    expect(res.status).toBe(400);
  });

  it('403 — MEMBER cannot update', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .patch(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(member))
      .send({ title: 'Hacked' });

    expect(res.status).toBe(403);
  });

  it('404 — non-existent announcement', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .patch(announcementUrl('non-existent-id'))
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'X' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /announcements/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE workspace announcement', () => {
  it('200 — OWNER (creator) deletes their announcement', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id);

    const res = await request(app)
      .delete(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const db = await prisma.announcement.findUnique({ where: { id: ann.id } });
    expect(db).toBeNull();
  });

  it('200 — ADMIN can delete any workspace announcement', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const res = await request(app)
      .delete(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(admin));

    expect(res.status).toBe(200);
  });

  it('403 — MEMBER cannot delete', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .delete(announcementUrl(ann.id))
      .set(await authWithCsrfHeaders(member));

    expect(res.status).toBe(403);
  });

  it('404 — non-existent announcement', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete(announcementUrl('non-existent-id'))
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated cannot delete', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const ann = await createAnnouncement(workspace.slug, user.id);

    const res = await request(app).delete(announcementUrl(ann.id));

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /workspaces/:slug/projects/:projectId/announcements
// ─────────────────────────────────────────────────────────────────────────────

describe('Project announcements', () => {
  it('200 — returns only announcements scoped to the requested project', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, user.id);

    // Workspace-level announcement (no projectId)
    await createAnnouncement(workspace.slug, user.id, { title: 'WS Level' });
    // Project-level announcement
    await createAnnouncement(workspace.slug, user.id, {
      title: 'Project Level',
      projectId: project.id,
    });

    const res = await request(app)
      .get(projectAnnouncementsUrl(workspace.slug, project.id))
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    const list = res.body.data;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((a: any) => a.projectId === project.id)).toBe(true);
    expect(list.some((a: any) => a.title === 'WS Level')).toBe(false);
  });

  it('200 — project MANAGER member can view project announcements', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const manager = await createUser();
    await addMemberToWorkspace(manager.id, workspace.id, WorkspaceRole.MEMBER);
    const project = await createProject(workspace.id, owner.id);
    await addProjectManager(project.id, manager.id);

    await createAnnouncement(workspace.slug, owner.id, {
      title: 'Project News',
      projectId: project.id,
    });

    const res = await request(app)
      .get(projectAnnouncementsUrl(workspace.slug, project.id))
      .set(authHeaders(manager));

    expect(res.status).toBe(200);
    expect(res.body.data.some((a: any) => a.title === 'Project News')).toBe(true);
  });

  it('201 — workspace ADMIN can create a project announcement', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);

    // ADMIN has canManageProjectAnnouncements === true (workspace role satisfies it)
    const admin = await createUser();
    await addMemberToWorkspace(admin.id, workspace.id, WorkspaceRole.ADMIN);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(admin))
      .send({
        title: 'Admin Project Announcement',
        content: 'For the project.',
        projectId: project.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.projectId).toBe(project.id);
  });

  it('403 — plain MEMBER (no project role) cannot create project announcement', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);

    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);
    // Deliberately NOT added to project

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(member))
      .send({
        title: 'Should Fail',
        content: 'No project role.',
        projectId: project.id,
      });

    expect(res.status).toBe(403);
  });

  it('400 — projectId that does not belong to the workspace is rejected', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const { workspace: otherWs, user: otherUser } = await createWorkspaceWithOwner();
    const otherProject = await createProject(otherWs.id, otherUser.id);

    const res = await request(app)
      .post(wsAnnouncementsUrl(workspace.slug))
      .set(await authWithCsrfHeaders(user))
      .send({
        title: 'Wrong Workspace Project',
        content: 'Should be rejected.',
        projectId: otherProject.id,
      });

    expect(res.status).toBe(400);
  });

  it('403 — non-member cannot list project announcements', async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const project = await createProject(workspace.id, owner.id);
    const outsider = await createUser();

    const res = await request(app)
      .get(projectAnnouncementsUrl(workspace.slug, project.id))
      .set(authHeaders(outsider));

    expect(res.status).toBe(403);
  });
});