/**
 * src/lib/contracts/project.contract.ts
 *
 * CANONICAL WIRE CONTRACTS for project API payloads.
 *
 * These schemas describe exactly what the HTTP API returns — they are the
 * single source of truth shared between backend enforcement (contract tests)
 * and the frontend (synced via `npm run sync:contracts`). If you change what a
 * project endpoint returns, change it HERE first; the contract tests will
 * force every consumer to be updated deliberately.
 *
 * Conventions:
 *  - Nullable DB columns are `.nullable()` — never assume presence.
 *    Project.workspace is nullable because the relation is a compound FK on
 *    (workspaceId, workspaceSlug) and rows that predate migration
 *    20260826120000 (or dangling rows) resolve it to null.
 *  - Timestamps are ISO strings over the wire (JSON serialization of Date).
 *  - Complex objects use `.passthrough()` so unknown/new fields don't break
 *    older consumers — strictness is reserved for identity-critical fields.
 *
 * Compatible with Zod v3 (frontend) and v4 (backend).
 */
import { z } from "zod";

// ─── Shared fragments ──────────────────────────────────────────────────────────

export const workspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  slug: z.string(),
});

export const memberUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
});

/** Full ProjectMember row as included by projectListInclude. */
export const projectMemberSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    userId: z.string(),
    role: z.string(),
    joinedAt: z.string(), // ISO datetime
    user: memberUserSchema,
  })
  .passthrough();

// ─── GET /api/v1/projects/user/all ─────────────────────────────────────────────

export const projectListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    icon: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
    startDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    workspaceId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    createdById: z.string(),
    slug: z.string(),
    /** Nullable — see header note about the compound FK. */
    workspace: workspaceSummarySchema.nullable(),
    members: z.array(projectMemberSchema),
    _count: z.object({
      tasks: z.number(),
    }),
    /** Computed server-side: true when the user owns/admins the workspace. */
    isAdmin: z.boolean(),
  })
  .passthrough();

export type ProjectListItem = z.infer<typeof projectListItemSchema>;

// ─── GET /api/v1/projects/workspace/:workspaceId ───────────────────────────────

export const workspaceProjectListItemSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
    dueDate: z.string().nullable(),
    members: z.array(projectMemberSchema),
    _count: z.object({
      tasks: z.number(),
      members: z.number(),
    }),
  })
  .passthrough();

export type WorkspaceProjectListItem = z.infer<typeof workspaceProjectListItemSchema>;

// ─── POST /projects / PATCH /projects/:id (mutation responses: bare row) ──────

export const mutatedProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    priority: z.string(),
    workspaceId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    createdById: z.string(),
  })
  .passthrough();

export type MutatedProject = z.infer<typeof mutatedProjectSchema>;

// ─── GET /api/v1/projects/:projectId · /projects/slug/:slug (detail) ──────────

const detailTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    assignees: z.array(z.object({ user: memberUserSchema }).passthrough()),
    sprint: z.object({ id: z.string(), name: z.string() }).nullable(),
    milestone: z
      .object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        progress: z.number(),
      })
      .nullable(),
    _count: z.object({ comments: z.number() }),
  })
  .passthrough();

export const projectDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    workspaceId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    /** Nullable — see header note about the compound FK. */
    workspace: workspaceSummarySchema.nullable(),
    members: z.array(projectMemberSchema),
    tasks: z.array(detailTaskSchema),
    _count: z.object({
      tasks: z.number(),
      members: z.number(),
      announcement: z.number(),
    }),
    stats: z
      .object({
        totalTasks: z.number(),
        completedTasks: z.number(),
        inProgressTasks: z.number(),
        overdueTasks: z.number(),
        totalMembers: z.number(),
      })
      .passthrough(),
    isAdmin: z.boolean(),
  })
  .passthrough();

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

// ─── Envelope helpers ──────────────────────────────────────────────────────────

export const projectListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(projectListItemSchema),
});

export const workspaceProjectListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(workspaceProjectListItemSchema),
});
