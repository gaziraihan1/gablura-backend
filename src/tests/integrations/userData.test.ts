import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
} from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";
import { WorkspaceRole } from "@prisma/client";

const BASE = "/api/v1/user";
const TEST_PASSWORD = "TestPass1234!";

// Replace the email-queue leaf module so no BullMQ connection is needed and
// the enqueued job can be asserted directly.
vi.mock("../../queue/queues/email.queue.js", () => ({
  addSendEmailJob: vi.fn().mockResolvedValue(undefined),
}));

// Spy on token revocation (keeps real behaviour) so the "revokes all
// sessions immediately" acceptance criterion is asserted.
vi.mock("../../lib/auth/tokenRevocation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth/tokenRevocation.js")>();
  return {
    ...actual,
    revokeAllRefreshTokens: vi.fn(actual.revokeAllRefreshTokens),
  };
});

import { addSendEmailJob } from "../../queue/queues/email.queue.js";
import { revokeAllRefreshTokens } from "../../lib/auth/tokenRevocation.js";

/** auditLog() is fire-and-forget — poll briefly for the persisted row. */
async function waitForAudit(userId: string, event: string) {
  let found = null;
  for (let i = 0; i < 20; i++) {
    found = await prisma.auditLog.findFirst({ where: { userId, event } });
    if (found) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(found).not.toBeNull();
}

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = "true";
  vi.mocked(addSendEmailJob).mockClear();
  vi.mocked(revokeAllRefreshTokens).mockClear();
});

afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/user/export-data
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/user/export-data", () => {
  it("202 — queues a data-export email with the JSON bundle and audits DATA_EXPORT", async () => {
    const { user, workspace } = await createWorkspaceWithOwner({
      email: "export-me@gablura.test",
      name: "Export Me",
    });

    const res = await request(app)
      .post(`${BASE}/export-data`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);

    expect(addSendEmailJob).toHaveBeenCalledTimes(1);
    const job = vi.mocked(addSendEmailJob).mock.calls[0][0];
    expect(job.type).toBe("data-export-email");
    expect(job.to).toBe("export-me@gablura.test");
    expect(job.data.toEmail).toBe("export-me@gablura.test");
    expect(job.data.fileName).toMatch(/^gablura-export-.+\.json$/);

    const bundle = JSON.parse(job.data.json);
    expect(bundle.profile.email).toBe("export-me@gablura.test");
    expect(Array.isArray(bundle.workspaces.owned)).toBe(true);
    expect(
      bundle.workspaces.owned.some((w: { id: string }) => w.id === workspace.id)
    ).toBe(true);
    expect(Array.isArray(bundle.projects)).toBe(true);
    expect(Array.isArray(bundle.tasks)).toBe(true);
    expect(Array.isArray(bundle.comments)).toBe(true);
    expect(Array.isArray(bundle.focusSessions)).toBe(true);
    expect(Array.isArray(bundle.timeEntries)).toBe(true);
    expect(Array.isArray(bundle.notifications)).toBe(true);
    expect(Array.isArray(bundle.activity)).toBe(true);

    await waitForAudit(user.id, "DATA_EXPORT");
  });

  it("401 — unauthenticated requests are rejected", async () => {
    const res = await request(app).post(`${BASE}/export-data`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/user/account
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/v1/user/account", () => {
  it("401 — rejects a wrong password", async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(user))
      .send({ password: "WrongPassword!" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);

    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();
  });

  it("400 — requires a password when the account has one", async () => {
    const user = await createUser();

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();
  });

  it("200 — OAuth-only accounts (no password) can delete without one", async () => {
    const user = await prisma.user.create({
      data: {
        email: "oauth-only@gablura.test",
        name: "OAuth User",
        role: "USER",
        emailVerified: new Date(),
      },
    });

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(200);
    const gone = await prisma.user.findUnique({ where: { id: user.id } });
    expect(gone).toBeNull();
  });

  it("409 — blocks deletion while the user solely owns a workspace with other members", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(user))
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.data.workspaces).toHaveLength(1);
    expect(res.body.data.workspaces[0].id).toBe(workspace.id);

    // The account is left intact.
    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();
  });

  it("200 — deletes the account, revokes refresh tokens, and audits DATA_DELETION", async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(user))
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const gone = await prisma.user.findUnique({ where: { id: user.id } });
    expect(gone).toBeNull();

    // Solely owned workspaces with no other members are deleted too.
    const ws = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(ws).toBeNull();

    // Sessions/tokens are revoked (acceptance criterion).
    expect(vi.mocked(revokeAllRefreshTokens)).toHaveBeenCalledWith(user.id);

    await waitForAudit(user.id, "DATA_DELETION");
  });

  it("200 — keeps workspaces the user only belongs to (membership removed)", async () => {
    const { user: owner, workspace } = await createWorkspaceWithOwner();
    const member = await createUser();
    await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set(await authWithCsrfHeaders(member))
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(200);

    // Workspace survives; the deleted user's membership row is gone.
    const ws = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(ws).not.toBeNull();
    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: member.id },
    });
    expect(membership).toBeNull();
  });

  it("401 — unauthenticated requests are rejected", async () => {
    const res = await request(app).delete(`${BASE}/account`);
    expect(res.status).toBe(401);
  });
});
