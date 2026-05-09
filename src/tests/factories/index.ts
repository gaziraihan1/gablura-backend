// src/tests/factories/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// All field names match your Prisma schema exactly:

import { faker } from '@faker-js/faker';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import type {
  User,
  Workspace,
  WorkspaceMember,
  Project,
  Task,
  Meeting,
  Announcement,
  Label,
  FeatureRequest,
} from '@prisma/client';
import {
  UserRole,
  WorkspaceRole,
  ProjectStatus,
  Priority,
  TaskStatus,
  MeetingStatus,
  MeetingVisibility,
  AnnouncementVisibility,
} from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Argon2 is slow — cache the hash across all test factories */
let _cachedHash: string | null = null;
async function getPasswordHash(): Promise<string> {
  if (!_cachedHash) {
    _cachedHash = await argon2.hash('TestPass1234!');
  }
  return _cachedHash;
}

/** Unique alphanumeric slug */
function slug(prefix = 'ws'): string {
  return `${prefix}-${faker.string.alphanumeric(10).toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// User
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUserOptions {
  email?: string;
  name?: string;
  role?: UserRole;
  emailVerified?: Date | null;  // defaults to now() so authenticate passes
  bannedAt?: Date | null;
  banReason?: string;
}

/**
 * Creates a User in the test DB.
 *
 * IMPORTANT: emailVerified defaults to `new Date()` because your `authenticate`
 * middleware rejects users where emailVerified is null (returns 403).
 * Pass `emailVerified: null` only when specifically testing that flow.
 */
export async function createUser(opts: CreateUserOptions = {}): Promise<User> {
  const hash = await getPasswordHash();
  return prisma.user.create({
    data: {
      email: opts.email ?? faker.internet.email(),
      name: opts.name ?? faker.person.fullName(),
      password: hash,
      role: opts.role ?? UserRole.USER,
      emailVerified: opts.emailVerified !== undefined ? opts.emailVerified : new Date(),
      bannedAt: opts.bannedAt ?? null,
    },
  });
}

/** Creates a User with role ADMIN */
export async function createAdminUser(opts: CreateUserOptions = {}): Promise<User> {
  return createUser({ ...opts, role: UserRole.ADMIN });
}

/** Creates an unverified user (will get 403 EMAIL_NOT_VERIFIED from middleware) */
export async function createUnverifiedUser(opts: CreateUserOptions = {}): Promise<User> {
  return createUser({ ...opts, emailVerified: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateWorkspaceOptions {
  name?: string;
  slug?: string;
  isPublic?: boolean;
  plan?: "FREE" | "PRO" | "BUSINESS";

}

export async function createWorkspace(
  ownerId: string,
  opts: CreateWorkspaceOptions = {}
): Promise<Workspace> {
  return prisma.workspace.create({
    data: {
      name: opts.name ?? faker.company.name(),
      slug: opts.slug ?? slug('ws'),
      isPublic: opts.isPublic ?? false,
            plan: opts.plan ?? "PRO", // ✅ IMPORTANT FIX

      ownerId,
    },
  });
}

/**
 * The most common test setup: a verified user who owns a workspace
 * and has an OWNER WorkspaceMember record.
 */
export async function createWorkspaceWithOwner(
  userOpts: CreateUserOptions = {},
  wsOpts: CreateWorkspaceOptions = {}
): Promise<{ user: User; workspace: Workspace; membership: WorkspaceMember }> {
  const user = await createUser(userOpts);
  const workspace = await createWorkspace(user.id, wsOpts);
  const membership = await prisma.workspaceMember.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: WorkspaceRole.OWNER,
    },
  });
  return { user, workspace, membership };
}

/**
 * Adds an existing user to an existing workspace.
 * Returns the WorkspaceMember record.
 */
export async function addMemberToWorkspace(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole = WorkspaceRole.MEMBER
): Promise<WorkspaceMember> {
  return prisma.workspaceMember.create({
    data: { userId, workspaceId, role },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateProjectOptions {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  priority?: Priority;
  slug?: string;
}

export async function createProject(
  workspaceId: string,
  createdById: string,
  opts: CreateProjectOptions = {}
): Promise<Project> {
  const projectSlug = opts.slug ?? slug('proj');
  return prisma.project.create({
    data: {
      name: opts.name ?? faker.commerce.productName(),
      description: opts.description ?? faker.lorem.sentence(),
      slug: projectSlug,
      status: opts.status ?? ProjectStatus.ACTIVE,
      priority: opts.priority ?? Priority.MEDIUM,
      workspaceId,
      createdById,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Task
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTaskOptions {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  projectId?: string;
  dueDate?: Date;
  estimatedHours?: number;
  parentId?: string;
  completedAt?: Date | null;
}

export async function createTask(
  workspaceId: string,
  createdById: string,
  opts: CreateTaskOptions = {}
): Promise<Task> {
  return prisma.task.create({
    data: {
      title: opts.title ?? faker.lorem.words(4),
      description: opts.description ?? faker.lorem.sentence(),
      status: opts.status ?? TaskStatus.TODO,
      priority: opts.priority ?? Priority.MEDIUM,
      workspaceId,
      createdById,
      projectId: opts.projectId ?? null,
      dueDate: opts.dueDate ?? null,
      estimatedHours: opts.estimatedHours ?? null,
      parentId: opts.parentId ?? null,
      completedAt: opts.status === TaskStatus.COMPLETED ? new Date() : null, // auto-set completedAt for convenience
      ...opts
    },
  });
}

/**
 * Creates N tasks using createMany (faster, no individual record returns).
 */
export async function createManyTasks(
  workspaceId: string,
  createdById: string,
  count: number,
  opts: CreateTaskOptions = {}
): Promise<void> {
  await prisma.task.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      title: opts.title ?? `Task ${i + 1} — ${faker.lorem.words(2)}`,
      status: opts.status ?? TaskStatus.TODO,
      priority: opts.priority ?? Priority.MEDIUM,
      workspaceId,
      createdById,
      projectId: opts.projectId ?? null,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Meeting
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateMeetingOptions {
  title?: string;
  description?: string;
  status?: MeetingStatus;
  visibility?: MeetingVisibility;
  startTime?: Date;
  endTime?: Date;
}

export async function createMeeting(
  workspaceId: string,
  createdById: string,
  opts: CreateMeetingOptions = {}
): Promise<Meeting> {
  const startTime = opts.startTime ?? faker.date.soon({ days: 3 });
  const endTime =
    opts.endTime ??
    new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

  return prisma.meeting.create({
    data: {
      title: opts.title ?? faker.lorem.words(4),
      description: opts.description ?? null,
      status: opts.status ?? MeetingStatus.SCHEDULED,
      visibility: opts.visibility ?? MeetingVisibility.PUBLIC,
      startTime,
      endTime,
      workspaceId,
      createdById,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Announcement
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAnnouncementOptions {
  title?: string;
  content?: string;
  visibility?: AnnouncementVisibility;
  isPinned?: boolean;
  projectId?: string;
}

export async function createAnnouncement(
  workspaceId: string,
  createdById: string,
  opts: CreateAnnouncementOptions = {}
): Promise<Announcement> {
  return prisma.announcement.create({
    data: {
      title: opts.title ?? faker.lorem.sentence(),
      content: opts.content ?? faker.lorem.paragraph(),
      visibility: opts.visibility ?? AnnouncementVisibility.PUBLIC,
      isPinned: opts.isPinned ?? false,
      workspaceId,
      createdById,
      projectId: opts.projectId ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Label
// ─────────────────────────────────────────────────────────────────────────────

export async function createLabel(
  workspaceId: string,
  createdById: string,
  opts: { name?: string; color?: string } = {}
): Promise<Label> {
  return prisma.label.create({
    data: {
      name: opts.name ?? faker.word.noun(),
      color: opts.color ?? faker.color.rgb({ format: 'hex' }),
      workspaceId,
      createdById,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Request
// ─────────────────────────────────────────────────────────────────────────────

export async function createFeatureRequest(
  createdById: string,
  opts: { title?: string; description?: string } = {}
): Promise<FeatureRequest> {
  return prisma.featureRequest.create({
    data: {
      title: opts.title ?? faker.lorem.sentence(),
      description: opts.description ?? faker.lorem.paragraph(),
      createdById,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Activity
// ─────────────────────────────────────────────────────────────

import { ActivityType, EntityType } from '@prisma/client';

export interface CreateActivityOptions {
  action?: ActivityType;
  entityType?: EntityType;
  entityId?: string;
  taskId?: string;
  metadata?: Record<string, any>;
}

export async function createActivity(
  userId: string,
  workspaceId: string,
  opts: CreateActivityOptions = {}
) {
  return prisma.activity.create({
    data: {
      action: opts.action ?? 'CREATED',
      entityType: opts.entityType ?? 'TASK',
      entityId: opts.entityId ?? faker.string.uuid(),
      userId,
      workspaceId,
      taskId: opts.taskId ?? null,
      metadata: opts.metadata ?? {},
    },
  });
}
export async function assignUserToTask(
  taskId: string,
  userId: string
) {
  return prisma.taskAssignee.create({
    data: {
      taskId,
      userId,
    },
  });
}