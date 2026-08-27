/**
 * src/lib/contracts/normalize.ts
 *
 * Thin DTO normalizers applied on API read paths BEFORE responses are cached /
 * serialized. They guarantee the shapes declared in `*.contract.ts`:
 *
 *   - nullable relations are explicitly `null` (never `undefined`), so
 *     `task.project.workspace` is always present-or-null, never missing;
 *   - collection fields are always arrays;
 *   - computed flags are always booleans.
 *
 * Today (post-backfill) these are effectively identity functions over fresh
 * Prisma rows — their job is to make the wire format structurally guaranteed
 * and to give future shape changes one deliberate place to happen instead of
 * leaking raw query results into responses.
 */
import type { ProjectListItem } from "./project.contract.js";
import type { TaskListItem } from "./task.contract.js";

// ─── Project payloads ──────────────────────────────────────────────────────────

type RawProjectRow = Record<string, unknown> & {
  workspace?: unknown;
  members?: unknown;
  _count?: unknown;
  isAdmin?: unknown;
};

/** Guarantees `workspace` is present-or-null and collections are arrays. */
export function normalizeProjectListItem<T extends RawProjectRow>(row: T): T & Pick<ProjectListItem, "workspace" | "members" | "isAdmin"> {
  return {
    ...row,
    workspace: (row.workspace ?? null) as ProjectListItem["workspace"],
    members: (Array.isArray(row.members) ? row.members : []) as ProjectListItem["members"],
    isAdmin: Boolean(row.isAdmin),
  };
}

export function normalizeProjectList<T extends RawProjectRow>(rows: T[]) {
  return rows.map(normalizeProjectListItem);
}

/** Workspace-scoped list items carry no workspace object — just fix collections. */
export function normalizeWorkspaceProjectListItem<T extends RawProjectRow>(row: T): T {
  return {
    ...row,
    members: Array.isArray(row.members) ? row.members : [],
    _count:
      row._count && typeof row._count === "object"
        ? row._count
        : { tasks: 0, members: 0 },
  };
}

// ─── Task payloads ─────────────────────────────────────────────────────────────

type RawTaskRow = Record<string, unknown> & {
  project?: {
    workspace?: unknown;
    [key: string]: unknown;
  } | null;
  assignees?: unknown;
  labels?: unknown;
};

/**
 * Guarantees `project` is present-or-null AND, when present, its `workspace`
 * summary is present-or-null. This is the invariant whose violation caused the
 * "Cannot read properties of null (reading 'name')" crashes in the frontend.
 */
export function normalizeTaskListItem<T extends RawTaskRow>(task: T): T {
  return {
    ...task,
    project:
      task.project == null
        ? null
        : ({ ...task.project, workspace: (task.project.workspace ?? null) } as T["project"]),
    assignees: (Array.isArray(task.assignees) ? task.assignees : []) as T["assignees"],
    labels: (Array.isArray(task.labels) ? task.labels : []) as T["labels"],
  };
}
