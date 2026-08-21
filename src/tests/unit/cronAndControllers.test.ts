import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// HOISTED MOCKS — factory access variables declared before vi.mock calls
// ═══════════════════════════════════════════════════════════════════════════════

const {
  mockPrisma,
  mockGetRedisClient,
  mockCacheClient,
  mockAddSendNotificationJob,
  mockNotificationMutation,
  mockNotificationQuery,
  mockGetPublisher,
  mockPublisherObj,
  mockWorkspaceQuery,
  mockWorkspaceMutation,
  mockWorkspaceActivity,
  mockWorkspaceNotifications,
  mockStorageQuery,
  mockStorageMutation,
  mockStorageAccess,
  mockStorageCache,
  mockResourceQueries,
  mockResourceMutations,
  mockCronSchedule,
  mockProcessPendingNotifications,
} = vi.hoisted(() => {
  const mockPrisma = {
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: {
      create: vi.fn(),
      createManyAndReturn: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    taskAssignee: { findMany: vi.fn() },
    workspaceMember: { findMany: vi.fn(), findUnique: vi.fn() },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    meeting: {
      findMany: vi.fn(),
    },
    workspace: { findUnique: vi.fn() },
    file: { aggregate: vi.fn() },
  };

  const mockGetRedisClient = vi.fn().mockReturnValue({
    pipeline: vi.fn().mockReturnValue({
      get: vi.fn(),
      setex: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    get: vi.fn(),
    setex: vi.fn(),
  });

  const mockCacheClient = {
    getOrSet: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
    get: vi.fn(),
    set: vi.fn(),
  };

  const mockAddSendNotificationJob = vi.fn().mockResolvedValue({});

  const mockNotificationMutation = {
    create: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    deleteAllReadNotifications: vi.fn(),
    deleteOldReadNotifications: vi.fn(),
  };
  const mockNotificationQuery = {
    getUserNotification: vi.fn(),
    getUnreadCount: vi.fn(),
  };

  const mockPublisherObj = {
    publish: vi.fn().mockResolvedValue(1),
    setex: vi.fn().mockResolvedValue('OK'),
  };
  const mockGetPublisher = vi.fn().mockReturnValue(mockPublisherObj);

  const mockWorkspaceQuery = {
    getUserWorkspaces: vi.fn(),
    getById: vi.fn(),
    getBySlug: vi.fn(),
    getOverview: vi.fn(),
    getMembers: vi.fn(),
    getInvitationByToken: vi.fn(),
    getStats: vi.fn(),
  };
  const mockWorkspaceMutation = {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    inviteMember: vi.fn(),
    acceptInvitation: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    leaveWorkspace: vi.fn(),
  };
  const mockWorkspaceActivity = {
    logCreated: vi.fn(),
    logUpdated: vi.fn(),
  };
  const mockWorkspaceNotifications = {
    notifyInvited: vi.fn(),
    notifyAccepted: vi.fn(),
    notifyAdmins: vi.fn(),
    notifyRemoved: vi.fn(),
    notifyRoleChanged: vi.fn(),
  };

  const mockStorageQuery = {
    getUserWorkspacesSummary: vi.fn(),
    getWorkspaceStorageInfo: vi.fn(),
    getWorkspaceStorageBreakdown: vi.fn(),
    getLargestFiles: vi.fn(),
    getStorageTrend: vi.fn(),
    getFileTypeBreakdown: vi.fn(),
    getMyContribution: vi.fn(),
    getUserContributions: vi.fn(),
  };
  const mockStorageMutation = {
    bulkDeleteFiles: vi.fn(),
    deleteFile: vi.fn(),
    canUploadFile: vi.fn(),
  };
  const mockStorageAccess = {
    isAdmin: vi.fn(),
    assertMember: vi.fn(),
    getUserRole: vi.fn(),
  };
  const mockStorageCache = {
    invalidateAll: vi.fn(),
    invalidateUserSummary: vi.fn(),
  };

  const mockResourceQueries = {
    findPopularResources: vi.fn(),
    findPopularResourceBySlug: vi.fn(),
    findPublicPopularResources: vi.fn(),
    findPublicPopularResourceBySlug: vi.fn(),
    findProductUpdates: vi.fn(),
    findProductUpdateBySlug: vi.fn(),
    findPublicProductUpdates: vi.fn(),
    findPublicProductUpdateBySlug: vi.fn(),
  };
  const mockResourceMutations = {
    createPopularResource: vi.fn(),
    updatePopularResource: vi.fn(),
    deletePopularResource: vi.fn(),
    createProductUpdate: vi.fn(),
    updateProductUpdate: vi.fn(),
    deleteProductUpdate: vi.fn(),
  };

  const mockCronSchedule = vi.fn();
  const mockProcessPendingNotifications = vi.fn().mockResolvedValue(0);

  return {
    mockPrisma, mockGetRedisClient, mockCacheClient, mockAddSendNotificationJob,
    mockNotificationMutation, mockNotificationQuery, mockGetPublisher, mockPublisherObj,
    mockWorkspaceQuery, mockWorkspaceMutation, mockWorkspaceActivity, mockWorkspaceNotifications,
    mockStorageQuery, mockStorageMutation, mockStorageAccess, mockStorageCache,
    mockResourceQueries, mockResourceMutations, mockCronSchedule, mockProcessPendingNotifications,
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE MOCKS — use relative paths from src/tests/unit/ to src/modules/
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../redis/redis.client.js', () => ({ getRedisClient: mockGetRedisClient }));
vi.mock('../../lib/redis/cache.client.js', () => ({
  CacheClient: mockCacheClient,
  CACHE_KEYS: {
    storageWorkspacesSummary: (userId: string) => `storage:summary:${userId}`,
    storageOverview: (wid: string, uid: string) => `storage:overview:${wid}:${uid}`,
    storageInfo: (wid: string, uid: string) => `storage:info:${wid}:${uid}`,
    storageMyContribution: (wid: string, uid: string) => `storage:my:${wid}:${uid}`,
    storageUserContributions: (wid: string) => `storage:users:${wid}`,
    storageLargestFiles: (wid: string, limit: number) => `storage:largest:${wid}:${limit}`,
    userPermissions: (uid: string, wid: string) => `perms:${uid}:${wid}`,
  },
  CACHE_TTL: {
    STORAGE_WORKSPACES_SUMMARY: 120, STORAGE_OVERVIEW: 60, STORAGE_INFO: 60,
    STORAGE_MY_CONTRIBUTION: 60, STORAGE_USER_CONTRIBUTIONS: 120, STORAGE_LARGEST_FILES: 120,
    USER_PERMISSIONS: 300,
  },
  StorageCache: mockStorageCache,
  NotificationCache: { invalidateAll: vi.fn() },
}));
vi.mock('../../queue/queues/notification.queue.js', () => ({ addSendNotificationJob: mockAddSendNotificationJob }));
vi.mock('../../queue/queues/email.queue.js', () => ({ addEmailJob: vi.fn() }));
vi.mock('../../queue/index.js', () => ({ addSendNotificationJob: mockAddSendNotificationJob }));
vi.mock('../../utils/email.js', () => ({ sendEmail: vi.fn() }));
vi.mock('../../lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../services/slug.service.js', () => ({ generateSlug: vi.fn().mockResolvedValue('test-slug') }));
vi.mock('../../config/admin.config.js', () => ({ adminEmails: [] }));
vi.mock('../../lib/redis/redis.pubsub.js', () => ({ getPublisher: mockGetPublisher, getSubscriber: vi.fn(), subscribe: vi.fn() }));
vi.mock('../../lib/sse/sse.channels.js', () => ({
  userChannel: (userId: string) => `sse:user:${userId}`,
}));

vi.mock('../../modules/notification/notification.helpers.js', () => ({
  notifyUser: vi.fn(),
  notifyUsers: vi.fn(),
  notifyTaskAssignees: vi.fn(),
  notifyWorkspaceMembers: vi.fn(),
  notifyMentions: vi.fn(),
  getPublishMetrics: vi.fn(),
  resetPublishMetrics: vi.fn(),
}));

vi.mock('../../modules/notification/notification.mutation.js', () => ({
  NotificationMutation: mockNotificationMutation,
}));
vi.mock('../../modules/notification/notification.query.js', () => ({
  NotificationQuery: mockNotificationQuery,
}));
vi.mock('../../modules/notification/cron.utils.js', () => ({
  processPendingNotifications: mockProcessPendingNotifications,
  batchWasAlreadySent: vi.fn().mockResolvedValue(new Set()),
  DEDUP_PREFIX: 'notif:cron:sent:',
}));
vi.mock('node-cron', () => ({ default: { schedule: mockCronSchedule } }));

vi.mock('../../modules/workspace/index.js', () => ({
  WorkspaceQuery: mockWorkspaceQuery,
  WorkspaceMutation: mockWorkspaceMutation,
  WorkspaceActivity: mockWorkspaceActivity,
  WorkspaceNotifications: mockWorkspaceNotifications,
}));
vi.mock('../../modules/workspace/workspace.validators.js', async () => {
  const { z } = await import('zod');
  return {
    createWorkspaceSchema: z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
      logo: z.string().url().optional(),
      isPublic: z.boolean().optional(),
    }),
    updateWorkspaceSchema: z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
      logo: z.string().url().optional(),
      isPublic: z.boolean().optional(),
      allowInvites: z.boolean().optional(),
    }),
    inviteMemberSchema: z.object({
      email: z.string().email(),
      role: z.enum(['MEMBER', 'ADMIN', 'GUEST']),
    }),
  };
});

vi.mock('../../modules/storage/storage.query.js', () => ({ StorageQuery: mockStorageQuery }));
vi.mock('../../modules/storage/storage.mutation.js', () => ({ StorageMutation: mockStorageMutation }));
vi.mock('../../modules/storage/storage.access.js', () => ({ StorageAccess: mockStorageAccess }));
vi.mock('../../modules/storage/storage.validators.js', async () => {
  const { z } = await import('zod');
  return {
    largestFilesQuerySchema: z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
    bulkDeleteSchema: z.object({ fileIds: z.array(z.string()).min(1, 'At least one file ID is required') }),
    checkUploadSchema: z.object({ fileSize: z.number().positive('File size must be a positive number') }),
  };
});

vi.mock('../../modules/resource/resource.query.js', () => ({
  findPopularResources: mockResourceQueries.findPopularResources,
  findPopularResourceBySlug: mockResourceQueries.findPopularResourceBySlug,
  findPublicPopularResources: mockResourceQueries.findPublicPopularResources,
  findPublicPopularResourceBySlug: mockResourceQueries.findPublicPopularResourceBySlug,
  findProductUpdates: mockResourceQueries.findProductUpdates,
  findProductUpdateBySlug: mockResourceQueries.findProductUpdateBySlug,
  findPublicProductUpdates: mockResourceQueries.findPublicProductUpdates,
  findPublicProductUpdateBySlug: mockResourceQueries.findPublicProductUpdateBySlug,
}));
vi.mock('../../modules/resource/resource.mutation.js', () => ({
  createPopularResource: mockResourceMutations.createPopularResource,
  updatePopularResource: mockResourceMutations.updatePopularResource,
  deletePopularResource: mockResourceMutations.deletePopularResource,
  createProductUpdate: mockResourceMutations.createProductUpdate,
  updateProductUpdate: mockResourceMutations.updateProductUpdate,
  deleteProductUpdate: mockResourceMutations.deleteProductUpdate,
}));

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides: Record<string, any> = {}) {
  return { user: { id: 'user-1' }, params: {}, query: {}, body: {}, ...overrides } as any;
}

function mockNext() {
  return vi.fn();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. notification.cron.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe('notification.cron.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('startTaskReminderCron registers schedule and logs startup', async () => {
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    expect(mockCronSchedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron started'));
  });

  it('task reminder runs with empty task list', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });

  it('task reminder processes tasks with assignees', async () => {
    const dueDate = new Date(Date.now() + 6 * 60 * 60 * 1000);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([{
        id: 'task-1', title: 'Test', dueDate, createdById: 'u1',
        assignees: [{ userId: 'u2', user: { notifications: true } }],
      }])
      .mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', notifications: true }, { id: 'u2', notifications: true },
    ]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });

  it('task reminder notifies the creator of creator-only tasks (no assignees)', async () => {
    const dueDate = new Date(Date.now() + 6 * 60 * 60 * 1000);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([{
        id: 'task-1', title: 'Creator Only', dueDate, createdById: 'u1', assignees: [],
      }])
      .mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', notifications: true }]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.user.findMany).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });

  it('task reminder handles pagination', async () => {
    const dueDate = new Date(Date.now() + 30 * 60 * 1000);
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `task-${i}`, title: `Task ${i}`, dueDate, createdById: 'u1',
      assignees: [{ userId: 'u2', user: { notifications: true } }],
    }));
    mockPrisma.task.findMany.mockResolvedValueOnce(tasks).mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', notifications: true }, { id: 'u2', notifications: true },
    ]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });

  it('startMeetingReminderCron registers schedule and runs', async () => {
    mockPrisma.meeting.findMany.mockResolvedValue([]);
    const { startMeetingReminderCron } = await import('../../modules/notification/meeting.cron.js');
    startMeetingReminderCron();
    expect(mockCronSchedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function));
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Meeting reminder cron done'));
  });

  it('meeting reminder notifies private attendees and creator', async () => {
    const start = new Date(Date.now() + 14 * 60 * 1000);
    mockPrisma.meeting.findMany.mockResolvedValue([{
      id: 'm1', title: 'Sync', visibility: 'PRIVATE', createdById: 'u1',
      workspaceId: 'w1', startTime: start,
      attendees: [{ userId: 'u2' }], workspace: { slug: 'ws' },
    }]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', notifications: true }, { id: 'u2', notifications: true },
    ]);
    // Make the shared cron-dispatch mock actually enqueue (it normally returns
    // 0 to keep other cron tests hermetic).
    mockProcessPendingNotifications.mockImplementation(async (list: any[]) => {
      for (const n of list) await mockAddSendNotificationJob(n);
      return list.length;
    });

    try {
      const { startMeetingReminderCron } = await import('../../modules/notification/meeting.cron.js');
      startMeetingReminderCron();
      const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
      await handler();
      expect(mockAddSendNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MEETING_REMINDER', userId: 'u1' }),
      );
      expect(mockAddSendNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MEETING_REMINDER', userId: 'u2' }),
      );
    } finally {
      mockProcessPendingNotifications.mockResolvedValue(0);
    }
  });

  it('meeting reminder catches errors', async () => {
    mockPrisma.meeting.findMany.mockRejectedValue(new Error('DB error'));
    const { startMeetingReminderCron } = await import('../../modules/notification/meeting.cron.js');
    startMeetingReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Meeting reminder cron failed'), expect.any(Error));
  });

  it('task reminder catches errors', async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error('DB error'));
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron failed'), expect.any(Error));
  });

  it('startNotificationCleanupCron registers schedule', async () => {
    const { startNotificationCleanupCron } = await import('../../modules/notification/notification.cron.js');
    startNotificationCleanupCron();
    expect(mockCronSchedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Notification cleanup cron started'));
  });

  it('notification cleanup runs successfully', async () => {
    mockNotificationMutation.deleteOldReadNotifications.mockResolvedValue({ count: 5 });
    const { startNotificationCleanupCron } = await import('../../modules/notification/notification.cron.js');
    startNotificationCleanupCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockNotificationMutation.deleteOldReadNotifications).toHaveBeenCalledWith(30);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Deleted 5 old read notifications'));
  });

  it('notification cleanup catches errors', async () => {
    mockNotificationMutation.deleteOldReadNotifications.mockRejectedValue(new Error('DB fail'));
    const { startNotificationCleanupCron } = await import('../../modules/notification/notification.cron.js');
    startNotificationCleanupCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Notification cleanup cron failed'), expect.any(Error));
  });

  it('task reminder handles overdue tasks', async () => {
    const overdueDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([{
        id: 'task-od', title: 'Overdue', dueDate: overdueDate, createdById: 'u1',
        assignees: [{ userId: 'u2', user: { notifications: true } }],
      }])
      .mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', notifications: true }, { id: 'u2', notifications: true },
    ]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });

  it('task reminder skips disabled notification users', async () => {
    const dueDate = new Date(Date.now() + 6 * 60 * 60 * 1000);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([{
        id: 'task-1', title: 'Task', dueDate, createdById: 'u1',
        assignees: [{ userId: 'u2', user: { notifications: false } }],
      }])
      .mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', notifications: false }, { id: 'u2', notifications: false },
    ]);
    const { startTaskReminderCron } = await import('../../modules/notification/notification.cron.js');
    startTaskReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task reminder cron done'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. project.cron.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe('project.cron.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('startProjectReminderCron registers hourly schedule', async () => {
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    expect(mockCronSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron started'));
  });

  it('project reminder runs with no projects', async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron done'));
  });

  it('project reminder processes projects with recipients', async () => {
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p1', name: 'Proj', slug: 'proj', dueDate, workspace: { slug: 'ws' },
    }]);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'p1', members: [{ userId: 'mgr' }],
      workspace: { members: [{ userId: 'ow' }] },
    });
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron done'));
  });

  it('project reminder skips projects with no recipients', async () => {
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p1', name: 'Proj', slug: 'proj',
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      workspace: { slug: 'ws' },
    }]);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron done'));
  });

  it('project reminder catches errors', async () => {
    mockPrisma.project.findMany.mockRejectedValue(new Error('DB error'));
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron failed'), expect.any(Error));
  });

  it('project reminder handles overdue projects', async () => {
    const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p1', name: 'Overdue', slug: 'overdue', dueDate: pastDue, workspace: { slug: 'ws' },
    }]);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'p1', members: [{ userId: 'mgr' }], workspace: { members: [] },
    });
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron done'));
  });

  it('project reminder handles null dueDate', async () => {
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p1', name: 'No Due', slug: 'no-due', dueDate: null, workspace: { slug: 'ws' },
    }]);
    const { startProjectReminderCron } = await import('../../modules/notification/project.cron.js');
    startProjectReminderCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project reminder cron done'));
  });

  it('startProjectAutoArchiveCron registers schedule', async () => {
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    expect(mockCronSchedule).toHaveBeenCalledWith('0 */12 * * *', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project auto-archive cron started'));
  });

  it('auto-archive runs with no projects', async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project auto-archive cron done'));
  });

  it('auto-archive archives project with no activity', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p-old', name: 'Old', slug: 'old', dueDate: oldDate, updatedAt: oldDate,
      workspace: { slug: 'ws' },
    }]);
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst.mockResolvedValue(null);
    mockPrisma.project.update.mockResolvedValue({});
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'p-old', members: [{ userId: 'm1' }], workspace: { members: [{ userId: 'ow1' }] },
    });
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'p-old' }, data: { status: 'ARCHIVED' },
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Archived project "Old"'));
  });

  it('auto-archive skips project with recent task activity', async () => {
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p-act', name: 'Active', slug: 'active',
      dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      workspace: { slug: 'ws' },
    }]);
    mockPrisma.task.findFirst.mockResolvedValue({ id: 'recent-task' });
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it('auto-archive skips recently updated project', async () => {
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p-upd', name: 'Updated', slug: 'upd',
      dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      workspace: { slug: 'ws' },
    }]);
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'p-upd' });
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it('auto-archive handles project without workspace', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p-nows', name: 'No WS', slug: 'nows', dueDate: oldDate, updatedAt: oldDate, workspace: null,
    }]);
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst.mockResolvedValue(null);
    mockPrisma.project.update.mockResolvedValue({});
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'p-nows', members: [{ userId: 'm1' }], workspace: null,
    });
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.project.update).toHaveBeenCalled();
  });

  it('auto-archive catches errors', async () => {
    mockPrisma.project.findMany.mockRejectedValue(new Error('DB fail'));
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Project auto-archive cron failed'), expect.any(Error));
  });

  it('auto-archive handles project with no members', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    mockPrisma.project.findMany.mockResolvedValue([{
      id: 'p-nom', name: 'No Mbrs', slug: 'nom', dueDate: oldDate, updatedAt: oldDate,
      workspace: { slug: 'ws' },
    }]);
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst.mockResolvedValue(null);
    mockPrisma.project.update.mockResolvedValue({});
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'p-nom', members: [], workspace: { members: [{ userId: 'ow1' }] },
    });
    const { startProjectAutoArchiveCron } = await import('../../modules/notification/project.cron.js');
    startProjectAutoArchiveCron();
    const handler = mockCronSchedule.mock.calls[mockCronSchedule.mock.calls.length - 1][1];
    await handler();
    expect(mockPrisma.project.update).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. notification.helpers.ts — import ACTUAL module (not mocked)
// ═══════════════════════════════════════════════════════════════════════════════

describe('notification.helpers.ts', () => {
  // We need the ACTUAL notification.helpers, not the mocked version.
  // Use vi.importActual to get the real module.
  let notifyUser: typeof import('../../modules/notification/notification.helpers.js').notifyUser;
  let notifyUsers: typeof import('../../modules/notification/notification.helpers.js').notifyUsers;
  let notifyTaskAssignees: typeof import('../../modules/notification/notification.helpers.js').notifyTaskAssignees;
  let notifyWorkspaceMembers: typeof import('../../modules/notification/notification.helpers.js').notifyWorkspaceMembers;
  let notifyMentions: typeof import('../../modules/notification/notification.helpers.js').notifyMentions;
  let getPublishMetrics: typeof import('../../modules/notification/notification.helpers.js').getPublishMetrics;
  let resetPublishMetrics: typeof import('../../modules/notification/notification.helpers.js').resetPublishMetrics;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Import the ACTUAL module — we still need prisma and redis mocked
    const actual = await vi.importActual<typeof import('../../modules/notification/notification.helpers.js')>(
      '../../modules/notification/notification.helpers.js',
    );
    notifyUser = actual.notifyUser;
    notifyUsers = actual.notifyUsers;
    notifyTaskAssignees = actual.notifyTaskAssignees;
    notifyWorkspaceMembers = actual.notifyWorkspaceMembers;
    notifyMentions = actual.notifyMentions;
    getPublishMetrics = actual.getPublishMetrics;
    resetPublishMetrics = actual.resetPublishMetrics;
  });
  afterEach(() => vi.restoreAllMocks());

  describe('notifyUser', () => {
    it('creates a notification and publishes via SSE', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n1', type: 'TASK_ASSIGNED', title: 'A', message: 'M',
        actionUrl: '/tasks/1', createdAt: new Date(), read: false,
        sender: { id: 's1', name: 'S', image: null },
      });
      mockPublisherObj.publish.mockResolvedValue(1);

      await notifyUser({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'A', message: 'M' });
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
      );
    });

    it('handles SSE publish failure gracefully (retries then fails)', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n2', type: 'MENTION', title: 'M', message: 'M',
        actionUrl: null, createdAt: new Date(), read: false, sender: null,
      });
      mockPublisherObj.publish.mockRejectedValue(new Error('Redis down'));

      await notifyUser({ userId: 'u1', senderId: 's1', type: 'MENTION', title: 'M', message: 'M', actionUrl: '/t/1' });
      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it('creates with null senderId and actionUrl', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n3', type: 'SYSTEM', title: 'S', message: 'M',
        actionUrl: null, createdAt: new Date(), read: false, sender: null,
      });
      mockPublisherObj.publish.mockResolvedValue(1);

      await notifyUser({ userId: 'u1', type: 'PROJECT_UPDATE', title: 'S', message: 'M' });
      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });
  });

  describe('notifyUsers', () => {
    it('returns early for empty array', async () => {
      await notifyUsers([]);
      expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('creates multiple notifications in bulk and publishes SSE', async () => {
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([
        { id: 'n1', userId: 'u1', type: 'TASK_ASSIGNED', title: 'T', message: 'M', actionUrl: null, createdAt: new Date(), read: false },
        { id: 'n2', userId: 'u2', type: 'TASK_ASSIGNED', title: 'T', message: 'M', actionUrl: null, createdAt: new Date(), read: false },
      ]);
      await notifyUsers([
        { userId: 'u1', type: 'TASK_ASSIGNED', title: 'T', message: 'M' },
        { userId: 'u2', type: 'TASK_ASSIGNED', title: 'T', message: 'M' },
      ]);
      expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalled();
    });

    it('handles SSE publish failures in batch without throwing', async () => {
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([
        { id: 'n1', userId: 'u1', type: 'MENTION', title: 'T', message: 'M', actionUrl: null, createdAt: new Date(), read: false },
      ]);
      mockPublisherObj.publish.mockRejectedValue(new Error('Redis fail'));
      await notifyUsers([{ userId: 'u1', senderId: 's1', type: 'MENTION', title: 'T', message: 'M' }]);
      expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalled();
    });
  });

  describe('notifyTaskAssignees', () => {
    it('notifies all assignees except excluded user', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([
        { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' },
      ]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyTaskAssignees({
        taskId: 't1', senderId: 'u1', type: 'TASK_ASSIGNED', title: 'U',
        message: 'Updated', excludeUserId: 'u1',
      });
      expect(mockPrisma.taskAssignee.findMany).toHaveBeenCalledWith({
        where: { taskId: 't1' }, select: { userId: true },
      });
    });

    it('notifies all assignees when no exclude', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([{ userId: 'u1' }]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyTaskAssignees({
        taskId: 't1', senderId: 's1', type: 'TASK_COMPLETED', title: 'D', message: 'Done',
      });
      expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalled();
    });

    it('does nothing if no assignees', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([]);
      await notifyTaskAssignees({
        taskId: 't1', senderId: 's1', type: 'TASK_COMPLETED', title: 'D', message: 'Done',
      });
      expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('notifyWorkspaceMembers', () => {
    it('notifies all members except excluded', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyWorkspaceMembers({
        workspaceId: 'w1', senderId: 'u1', type: 'ROLE_UPDATED', title: 'U',
        message: 'Updated', excludeUserId: 'u1',
      });
      expect(mockPrisma.workspaceMember.findMany).toHaveBeenCalled();
    });

    it('notifies all when no exclude', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u1' }]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyWorkspaceMembers({
        workspaceId: 'w1', senderId: 's1', type: 'MEMBER_JOINED', title: 'C', message: 'Created',
      });
      expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalled();
    });

    it('handles empty member list', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([]);
      await notifyWorkspaceMembers({
        workspaceId: 'w1', senderId: 's1', type: 'ROLE_UPDATED', title: 'U', message: 'Updated',
      });
      expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('notifyMentions', () => {
    it('returns early if no mentions in text', async () => {
      await notifyMentions({
        text: 'Hello there', workspaceId: 'w1', senderId: 's1',
        senderName: 'S', context: 'comment',
      });
      expect(mockPrisma.workspaceMember.findMany).not.toHaveBeenCalled();
    });

    it('finds mentioned users and notifies them', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([
        { userId: 'm1' }, { userId: 'm2' },
      ]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyMentions({
        text: 'Hey @John and @Jane check this', workspaceId: 'w1', senderId: 's1',
        senderName: 'Sender', context: 'task comment', actionUrl: '/task/1',
      });
      expect(mockPrisma.workspaceMember.findMany).toHaveBeenCalled();
    });

    it('excludes sender from mention notifications', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([{ userId: 's1' }]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyMentions({
        text: 'Hey @Self', workspaceId: 'w1', senderId: 's1',
        senderName: 'S', context: 'c',
      });
      expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('deduplicates mentioned users', async () => {
      mockPrisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u1' }]);
      mockPrisma.notification.createManyAndReturn.mockResolvedValue([]);
      await notifyMentions({
        text: '@User @User', workspaceId: 'w1', senderId: 's1',
        senderName: 'S', context: 'c',
      });
      expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ userId: 'u1' })]),
        }),
      );
    });
  });

  describe('getPublishMetrics / resetPublishMetrics', () => {
    it('returns metrics object', () => {
      const m = getPublishMetrics();
      expect(m).toHaveProperty('totalAttempts');
      expect(m).toHaveProperty('successfulPublishes');
      expect(m).toHaveProperty('failedPublishes');
    });

    it('resets metrics to zero', () => {
      resetPublishMetrics();
      const m = getPublishMetrics();
      expect(m.totalAttempts).toBe(0);
      expect(m.successfulPublishes).toBe(0);
      expect(m.failedPublishes).toBe(0);
      expect(m.lastFailure).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. notification.controller.ts — import ACTUAL module
// ═══════════════════════════════════════════════════════════════════════════════

describe('notification.controller.ts', () => {
  let getNotifications: any, getUnreadCount: any, markAsRead: any;
  let markAllAsRead: any, deleteNotification: any, deleteAllRead: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const actual = await vi.importActual<any>('../../modules/notification/notification.controller.js');
    getNotifications = actual.getNotifications;
    getUnreadCount = actual.getUnreadCount;
    markAsRead = actual.markAsRead;
    markAllAsRead = actual.markAllAsRead;
    deleteNotification = actual.deleteNotification;
    deleteAllRead = actual.deleteAllRead;
  });
  afterEach(() => vi.restoreAllMocks());

  describe('getNotifications', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();
      await getNotifications(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Unauthorized' }));
    });

    it('returns notifications on success', async () => {
      const data = { items: [], nextCursor: null, hasMore: false };
      mockNotificationQuery.getUserNotification.mockResolvedValue(data);
      const req = mockReq({ query: {} });
      const res = mockRes();
      await getNotifications(req, res, mockNext());
      expect(res.json).toHaveBeenCalledWith({ success: true, data });
    });

    it('passes cursor to query', async () => {
      mockNotificationQuery.getUserNotification.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      const req = mockReq({ query: { cursor: 'abc' } });
      const res = mockRes();
      await getNotifications(req, res, mockNext());
      expect(mockNotificationQuery.getUserNotification).toHaveBeenCalledWith('user-1', 'abc');
    });

    it('returns 500 on error', async () => {
      mockNotificationQuery.getUserNotification.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();
      await getNotifications(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Failed to fetch notifications' }));
    });
  });

  describe('getUnreadCount', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();
      await getUnreadCount(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns unread count', async () => {
      mockNotificationQuery.getUnreadCount.mockResolvedValue({ count: 5 });
      const req = mockReq();
      const res = mockRes();
      await getUnreadCount(req, res, mockNext());
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { count: 5 } });
    });

    it('returns 500 on error', async () => {
      mockNotificationQuery.getUnreadCount.mockRejectedValue(new Error('fail'));
      const req = mockReq();
      const res = mockRes();
      await getUnreadCount(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('markAsRead', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined, params: { id: 'n1' } });
      const res = mockRes();
      await markAsRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('marks notification as read', async () => {
      mockNotificationMutation.markAsRead.mockResolvedValue({});
      const req = mockReq({ params: { id: 'n1' } });
      const res = mockRes();
      await markAsRead(req, res, mockNext());
      expect(mockNotificationMutation.markAsRead).toHaveBeenCalledWith('n1', 'user-1');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('returns 500 on error', async () => {
      mockNotificationMutation.markAsRead.mockRejectedValue(new Error('fail'));
      const req = mockReq({ params: { id: 'n1' } });
      const res = mockRes();
      await markAsRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('markAllAsRead', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();
      await markAllAsRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('marks all as read', async () => {
      mockNotificationMutation.markAllAsRead.mockResolvedValue({ count: 3 });
      const req = mockReq();
      const res = mockRes();
      await markAllAsRead(req, res, mockNext());
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { count: 3 } });
    });

    it('returns 500 on error', async () => {
      mockNotificationMutation.markAllAsRead.mockRejectedValue(new Error('fail'));
      const req = mockReq();
      const res = mockRes();
      await markAllAsRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('deleteNotification', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined, params: { id: 'n1' } });
      const res = mockRes();
      await deleteNotification(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('deletes notification', async () => {
      mockNotificationMutation.deleteNotification.mockResolvedValue(undefined);
      const req = mockReq({ params: { id: 'n1' } });
      const res = mockRes();
      await deleteNotification(req, res, mockNext());
      expect(mockNotificationMutation.deleteNotification).toHaveBeenCalledWith('n1', 'user-1');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Notification deleted successfully' }));
    });

    it('returns 500 on error', async () => {
      mockNotificationMutation.deleteNotification.mockRejectedValue(new Error('fail'));
      const req = mockReq({ params: { id: 'n1' } });
      const res = mockRes();
      await deleteNotification(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('deleteAllRead', () => {
    it('returns 401 if no user id', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();
      await deleteAllRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('deletes all read notifications', async () => {
      mockNotificationMutation.deleteAllReadNotifications.mockResolvedValue({ count: 10 });
      const req = mockReq();
      const res = mockRes();
      await deleteAllRead(req, res, mockNext());
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { count: 10 } });
    });

    it('returns 500 on error', async () => {
      mockNotificationMutation.deleteAllReadNotifications.mockRejectedValue(new Error('fail'));
      const req = mockReq();
      const res = mockRes();
      await deleteAllRead(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. workspace.controller.ts — import ACTUAL module
// ═══════════════════════════════════════════════════════════════════════════════

describe('workspace.controller.ts', () => {
  let ctrl: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ctrl = await vi.importActual<any>('../../modules/workspace/workspace.controller.js');
  });
  afterEach(() => vi.restoreAllMocks());

  function makeHandler(handler: any) {
    return async (reqOverrides: Record<string, any> = {}) => {
      const req = mockReq(reqOverrides);
      const res = mockRes();
      const next = mockNext();
      await handler(req, res, next);
      return { req, res, next };
    };
  }

  it('getAllWorkspaces returns user workspaces', async () => {
    mockWorkspaceQuery.getUserWorkspaces.mockResolvedValue([{ id: 'ws-1' }]);
    const run = makeHandler(ctrl.getAllWorkspaces);
    const { res } = await run();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'ws-1' }] });
  });

  it('createWorkspace creates with valid data', async () => {
    mockWorkspaceMutation.create.mockImplementation(async (_uid: string, _data: any, cb: any) => {
      await cb({ workspace: { id: 'ws-new', slug: 'new', name: 'New' } });
      return { id: 'ws-new' };
    });
    const run = makeHandler(ctrl.createWorkspace);
    const { res } = await run({ body: { name: 'My Workspace' } });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('createWorkspace throws ValidationError on invalid body', async () => {
    const run = makeHandler(ctrl.createWorkspace);
    const { next } = await run({ body: { name: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('getWorkspace fetches by slug', async () => {
    mockWorkspaceQuery.getBySlug.mockResolvedValue({ id: 'ws-1' });
    const run = makeHandler(ctrl.getWorkspace);
    const { res } = await run({ params: { slug: 'my-workspace' } });
    expect(mockWorkspaceQuery.getBySlug).toHaveBeenCalledWith('my-workspace', 'user-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'ws-1' } });
  });

  it('getWorkspace fetches by ID when param is ID-like', async () => {
    mockWorkspaceQuery.getById.mockResolvedValue({ id: 'abc123def456ghij7890' });
    const run = makeHandler(ctrl.getWorkspace);
    await run({ params: { slug: 'abc123def456ghij7890' } });
    expect(mockWorkspaceQuery.getById).toHaveBeenCalledWith('abc123def456ghij7890', 'user-1');
  });

  it('getWorkspaceOverview returns overview', async () => {
    mockWorkspaceQuery.getOverview.mockResolvedValue({ totalTasks: 5 });
    const run = makeHandler(ctrl.getWorkspaceOverview);
    const { res } = await run({ params: { slug: 'ws-slug' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { totalTasks: 5 } });
  });

  it('updateWorkspace updates with valid data', async () => {
    mockWorkspaceMutation.update.mockImplementation(async (_id: string, _uid: string, _data: any, cb: any) => {
      await cb({ workspace: { id: 'ws-1', slug: 'ws-1' } });
      return { id: 'ws-1' };
    });
    const run = makeHandler(ctrl.updateWorkspace);
    const { res } = await run({ params: { id: 'ws-1' }, body: { name: 'Updated' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('updateWorkspace throws ValidationError on invalid body', async () => {
    const run = makeHandler(ctrl.updateWorkspace);
    const { next } = await run({ params: { id: 'ws-1' }, body: { color: 'not-a-color' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('deleteWorkspace deletes', async () => {
    mockWorkspaceMutation.delete.mockResolvedValue(undefined);
    const run = makeHandler(ctrl.deleteWorkspace);
    const { res } = await run({ params: { id: 'ws-1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Workspace deleted successfully' }));
  });

  it('getMembers returns members', async () => {
    mockWorkspaceQuery.getMembers.mockResolvedValue([{ userId: 'u1' }]);
    const run = makeHandler(ctrl.getMembers);
    const { res } = await run({ params: { id: 'ws-1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ userId: 'u1' }] });
  });

  it('inviteMember invites with valid data', async () => {
    mockWorkspaceMutation.inviteMember.mockImplementation(async (_id: string, _uid: string, _email: string, _role: string, cb: any) => {
      await cb({ invitation: { token: 'tok', workspace: { name: 'WS' } }, inviterName: 'Test' });
      return { token: 'tok' };
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'invited', notifications: true });
    const run = makeHandler(ctrl.inviteMember);
    const { res } = await run({ params: { id: 'ws-1' }, body: { email: 'test@example.com', role: 'MEMBER' } });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('inviteMember throws ValidationError on invalid email', async () => {
    const run = makeHandler(ctrl.inviteMember);
    const { next } = await run({ params: { id: 'ws-1' }, body: { email: 'bad', role: 'MEMBER' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('inviteMember does not notify if notifications disabled', async () => {
    mockWorkspaceMutation.inviteMember.mockImplementation(async (_id: string, _uid: string, _email: string, _role: string, cb: any) => {
      await cb({ invitation: { token: 'tok', workspace: { name: 'WS' } }, inviterName: 'Test' });
      return { token: 'tok' };
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'invited', notifications: false });
    const run = makeHandler(ctrl.inviteMember);
    await run({ params: { id: 'ws-1' }, body: { email: 'test@example.com', role: 'ADMIN' } });
    expect(mockWorkspaceNotifications.notifyInvited).not.toHaveBeenCalled();
  });

  it('getInvitation returns invitation by token', async () => {
    mockWorkspaceQuery.getInvitationByToken.mockResolvedValue({ token: 'tok' });
    const run = makeHandler(ctrl.getInvitation);
    const { res } = await run({ params: { token: 'tok' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { token: 'tok' } });
  });

  it('acceptInvitation accepts and notifies', async () => {
    mockWorkspaceMutation.acceptInvitation.mockImplementation(async (_token: string, _uid: string, cb: any) => {
      await cb({ workspace: { name: 'WS', slug: 'ws' }, invitedBy: 'inv-1', userName: 'New' });
      return { id: 'ws-1' };
    });
    mockPrisma.user.findUnique.mockResolvedValue({ notifications: true });
    const run = makeHandler(ctrl.acceptInvitation);
    const { res } = await run({ params: { token: 'tok' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('acceptInvitation does not notify inviter if disabled', async () => {
    mockWorkspaceMutation.acceptInvitation.mockImplementation(async (_token: string, _uid: string, cb: any) => {
      await cb({ workspace: { name: 'WS', slug: 'ws' }, invitedBy: 'inv-1', userName: 'New' });
      return { id: 'ws-1' };
    });
    mockPrisma.user.findUnique.mockResolvedValue({ notifications: false });
    const run = makeHandler(ctrl.acceptInvitation);
    await run({ params: { token: 'tok' } });
    expect(mockWorkspaceNotifications.notifyAccepted).not.toHaveBeenCalled();
  });

  it('removeMember removes and notifies', async () => {
    mockWorkspaceMutation.removeMember.mockImplementation(async (_id: string, _uid: string, _mid: string, cb: any) => {
      await cb({ member: { userId: 'm1', user: { notifications: true }, workspace: { name: 'WS' } } });
    });
    const run = makeHandler(ctrl.removeMember);
    const { res } = await run({ params: { id: 'ws-1', memberId: 'm1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Member removed successfully' }));
  });

  it('removeMember does not notify if disabled', async () => {
    mockWorkspaceMutation.removeMember.mockImplementation(async (_id: string, _uid: string, _mid: string, cb: any) => {
      await cb({ member: { userId: 'm1', user: { notifications: false }, workspace: { name: 'WS' } } });
    });
    const run = makeHandler(ctrl.removeMember);
    await run({ params: { id: 'ws-1', memberId: 'm1' } });
    expect(mockWorkspaceNotifications.notifyRemoved).not.toHaveBeenCalled();
  });

  it('updateMemberRole updates and notifies', async () => {
    mockWorkspaceMutation.updateMemberRole.mockImplementation(async (_id: string, _uid: string, _mid: string, role: string, cb: any) => {
      await cb({ member: { userId: 'm1', user: { notifications: true } }, workspaceName: 'WS' });
      return { role };
    });
    const run = makeHandler(ctrl.updateMemberRole);
    const { res } = await run({ params: { id: 'ws-1', memberId: 'm1' }, body: { role: 'ADMIN' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('updateMemberRole does not notify if disabled', async () => {
    mockWorkspaceMutation.updateMemberRole.mockImplementation(async (_id: string, _uid: string, _mid: string, role: string, cb: any) => {
      await cb({ member: { userId: 'm1', user: { notifications: false } }, workspaceName: 'WS' });
      return { role };
    });
    const run = makeHandler(ctrl.updateMemberRole);
    await run({ params: { id: 'ws-1', memberId: 'm1' }, body: { role: 'GUEST' } });
    expect(mockWorkspaceNotifications.notifyRoleChanged).not.toHaveBeenCalled();
  });

  it('getStats returns workspace stats', async () => {
    mockWorkspaceQuery.getStats.mockResolvedValue({ totalTasks: 10 });
    const run = makeHandler(ctrl.getStats);
    const { res } = await run({ params: { id: 'ws-1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { totalTasks: 10 } });
  });

  it('leaveWorkspace leaves', async () => {
    mockWorkspaceMutation.leaveWorkspace.mockResolvedValue(undefined);
    const run = makeHandler(ctrl.leaveWorkspace);
    const { res } = await run({ params: { id: 'ws-1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'You have left the workspace' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. storage.controller.ts — import ACTUAL module
// ═══════════════════════════════════════════════════════════════════════════════

describe('storage.controller.ts', () => {
  let storageCtrl: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storageCtrl = await vi.importActual<any>('../../modules/storage/storage.controller.js');
  });
  afterEach(() => vi.restoreAllMocks());

  function makeHandler(handler: any) {
    return async (reqOverrides: Record<string, any> = {}) => {
      const req = mockReq(reqOverrides);
      const res = mockRes();
      const next = mockNext();
      await handler(req, res, next);
      return { req, res, next };
    };
  }

  it('getWorkspacesSummary throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getWorkspacesSummary);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getWorkspacesSummary returns storage summary', async () => {
    mockCacheClient.getOrSet.mockResolvedValue({ totalBytes: 1024 });
    const run = makeHandler(storageCtrl.getWorkspacesSummary);
    const { res } = await run();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { totalBytes: 1024 } });
  });

  it('getWorkspaceOverview throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getWorkspaceOverview);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getWorkspaceOverview returns for admin', async () => {
    mockCacheClient.getOrSet.mockImplementation(async (_k: string, fn: () => Promise<unknown>) => fn());
    mockStorageAccess.isAdmin.mockResolvedValue(true);
    mockStorageQuery.getWorkspaceStorageInfo.mockResolvedValue({ used: 100 });
    mockStorageQuery.getWorkspaceStorageBreakdown.mockResolvedValue([]);
    mockStorageQuery.getLargestFiles.mockResolvedValue([]);
    mockStorageQuery.getStorageTrend.mockResolvedValue([]);
    mockStorageQuery.getFileTypeBreakdown.mockResolvedValue([]);
    mockStorageQuery.getMyContribution.mockResolvedValue({});
    mockStorageQuery.getUserContributions.mockResolvedValue([]);
    const run = makeHandler(storageCtrl.getWorkspaceOverview);
    const { res } = await run({ params: { workspaceId: 'w1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('getWorkspaceOverview returns for non-admin', async () => {
    mockCacheClient.getOrSet.mockImplementation(async (_k: string, fn: () => Promise<unknown>) => fn());
    mockStorageAccess.isAdmin.mockResolvedValue(false);
    mockStorageQuery.getWorkspaceStorageInfo.mockResolvedValue({ used: 50 });
    mockStorageQuery.getWorkspaceStorageBreakdown.mockResolvedValue([]);
    mockStorageQuery.getLargestFiles.mockResolvedValue([]);
    mockStorageQuery.getStorageTrend.mockResolvedValue([]);
    mockStorageQuery.getFileTypeBreakdown.mockResolvedValue([]);
    mockStorageQuery.getMyContribution.mockResolvedValue({});
    const run = makeHandler(storageCtrl.getWorkspaceOverview);
    const { res } = await run({ params: { workspaceId: 'w1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('getWorkspaceInfo throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getWorkspaceInfo);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getWorkspaceInfo returns info', async () => {
    mockCacheClient.getOrSet.mockResolvedValue({ used: 200 });
    const run = makeHandler(storageCtrl.getWorkspaceInfo);
    const { res } = await run({ params: { workspaceId: 'w1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { used: 200 } });
  });

  it('getMyContribution throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getMyContribution);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getMyContribution returns contribution', async () => {
    mockCacheClient.getOrSet.mockResolvedValue({ files: 5 });
    const run = makeHandler(storageCtrl.getMyContribution);
    const { res } = await run({ params: { workspaceId: 'w1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { files: 5 } });
  });

  it('getUserContributions throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getUserContributions);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getUserContributions returns contributions', async () => {
    mockCacheClient.getOrSet.mockResolvedValue([{ userId: 'u1', bytes: 500 }]);
    const run = makeHandler(storageCtrl.getUserContributions);
    const { res } = await run({ params: { workspaceId: 'w1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ userId: 'u1', bytes: 500 }] });
  });

  it('getLargestFiles throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.getLargestFiles);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('getLargestFiles returns files', async () => {
    mockCacheClient.getOrSet.mockResolvedValue([{ name: 'big.zip', size: 1000 }]);
    const run = makeHandler(storageCtrl.getLargestFiles);
    const { res } = await run({ params: { workspaceId: 'w1' }, query: {} });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ name: 'big.zip', size: 1000 }] });
  });

  it('bulkDelete throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.bulkDelete);
    const { next } = await run({ user: undefined, params: { workspaceId: 'w1' }, body: { fileIds: ['f1'] } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('bulkDelete deletes files', async () => {
    mockStorageMutation.bulkDeleteFiles.mockResolvedValue({ message: 'Deleted 2', deletedCount: 2, freedMB: 5 });
    const run = makeHandler(storageCtrl.bulkDelete);
    const { res } = await run({ params: { workspaceId: 'w1' }, body: { fileIds: ['f1', 'f2'] } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { deletedCount: 2, freedMB: 5 } }));
  });

  it('deleteFile throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.deleteFile);
    const { next } = await run({ user: undefined, params: { fileId: 'f1' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('deleteFile succeeds with workspaceId', async () => {
    mockStorageMutation.deleteFile.mockResolvedValue({ success: true, message: 'Deleted', freedMB: 2, workspaceId: 'w1' });
    const run = makeHandler(storageCtrl.deleteFile);
    const { res } = await run({ params: { fileId: 'f1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { freedMB: 2 } }));
  });

  it('deleteFile returns 403 for permission errors', async () => {
    mockStorageMutation.deleteFile.mockResolvedValue({ success: false, message: 'permission denied' });
    const run = makeHandler(storageCtrl.deleteFile);
    const { res } = await run({ params: { fileId: 'f1' } });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deleteFile returns 404 for not found', async () => {
    mockStorageMutation.deleteFile.mockResolvedValue({ success: false, message: 'File not found' });
    const run = makeHandler(storageCtrl.deleteFile);
    const { res } = await run({ params: { fileId: 'f1' } });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteFile invalidates user summary when no workspaceId', async () => {
    mockStorageMutation.deleteFile.mockResolvedValue({ success: true, message: 'Deleted', freedMB: 1, workspaceId: null });
    const run = makeHandler(storageCtrl.deleteFile);
    await run({ params: { fileId: 'f1' } });
    expect(mockStorageCache.invalidateUserSummary).toHaveBeenCalledWith('user-1');
  });

  it('checkUpload throws UnauthorizedError if no user', async () => {
    const run = makeHandler(storageCtrl.checkUpload);
    const { next } = await run({ user: undefined });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('checkUpload returns allowed', async () => {
    mockStorageMutation.canUploadFile.mockResolvedValue({ allowed: true, reason: null });
    const run = makeHandler(storageCtrl.checkUpload);
    const { res } = await run({ params: { workspaceId: 'w1' }, body: { fileSize: 1024 } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('checkUpload returns denied', async () => {
    mockStorageMutation.canUploadFile.mockResolvedValue({ allowed: false, reason: 'Storage full' });
    const run = makeHandler(storageCtrl.checkUpload);
    const { res } = await run({ params: { workspaceId: 'w1' }, body: { fileSize: 999999999 } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Storage full' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. resource.controller.ts — import ACTUAL module
// ═══════════════════════════════════════════════════════════════════════════════

describe('resource.controller.ts', () => {
  let resourceCtrl: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resourceCtrl = await vi.importActual<any>('../../modules/resource/resource.controller.js');
  });
  afterEach(() => vi.restoreAllMocks());

  function makeHandler(handler: any) {
    return async (reqOverrides: Record<string, any> = {}) => {
      const req = mockReq(reqOverrides);
      const res = mockRes();
      const next = mockNext();
      await handler(req, res, next);
      return { req, res, next };
    };
  }

  it('adminListPopularResources lists with defaults', async () => {
    mockResourceQueries.findPopularResources.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.adminListPopularResources);
    const { res } = await run({ query: {} });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [], total: 0 } });
  });

  it('adminListPopularResources passes filters', async () => {
    mockResourceQueries.findPopularResources.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.adminListPopularResources);
    await run({ query: { status: 'PUBLIC', category: 'tools', page: '2', limit: '5' } });
    expect(mockResourceQueries.findPopularResources).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLIC', category: 'tools', page: 2, limit: 5 }),
    );
  });

  it('adminGetPopularResource returns by slug', async () => {
    mockResourceQueries.findPopularResourceBySlug.mockResolvedValue({ slug: 'test' });
    const run = makeHandler(resourceCtrl.adminGetPopularResource);
    const { res } = await run({ params: { slug: 'test' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { slug: 'test' } });
  });

  it('adminGetPopularResource throws NotFoundError', async () => {
    mockResourceQueries.findPopularResourceBySlug.mockResolvedValue(null);
    const run = makeHandler(resourceCtrl.adminGetPopularResource);
    const { next } = await run({ params: { slug: 'missing' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('adminGetPopularResource throws ValidationError for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminGetPopularResource);
    const { next } = await run({ params: { slug: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminCreatePopularResource creates with valid body', async () => {
    mockResourceMutations.createPopularResource.mockResolvedValue({ slug: 'new' });
    const run = makeHandler(resourceCtrl.adminCreatePopularResource);
    const { res } = await run({
      user: { id: 'admin' },
      body: { title: 'R', description: 'D', image: 'https://example.com/img.png', category: 'cat' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('adminCreatePopularResource throws ValidationError on invalid body', async () => {
    const run = makeHandler(resourceCtrl.adminCreatePopularResource);
    const { next } = await run({ user: { id: 'admin' }, body: { title: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminUpdatePopularResource updates', async () => {
    mockResourceMutations.updatePopularResource.mockResolvedValue({ slug: 'upd' });
    const run = makeHandler(resourceCtrl.adminUpdatePopularResource);
    const { res } = await run({ params: { slug: 'test' }, body: { title: 'Updated' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Popular resource updated' }));
  });

  it('adminUpdatePopularResource throws for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminUpdatePopularResource);
    const { next } = await run({ params: { slug: '' }, body: { title: 'x' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminDeletePopularResource deletes', async () => {
    mockResourceMutations.deletePopularResource.mockResolvedValue(undefined);
    const run = makeHandler(resourceCtrl.adminDeletePopularResource);
    const { res } = await run({ params: { slug: 'del' } });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('adminDeletePopularResource throws for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminDeletePopularResource);
    const { next } = await run({ params: { slug: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminListProductUpdates lists with defaults', async () => {
    mockResourceQueries.findProductUpdates.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.adminListProductUpdates);
    const { res } = await run({ query: {} });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [], total: 0 } });
  });

  it('adminListProductUpdates passes filters', async () => {
    mockResourceQueries.findProductUpdates.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.adminListProductUpdates);
    await run({ query: { status: 'PUBLIC', page: '3', limit: '10' } });
    expect(mockResourceQueries.findProductUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLIC', page: 3, limit: 10 }),
    );
  });

  it('adminGetProductUpdate returns by slug', async () => {
    mockResourceQueries.findProductUpdateBySlug.mockResolvedValue({ slug: 'v1' });
    const run = makeHandler(resourceCtrl.adminGetProductUpdate);
    const { res } = await run({ params: { slug: 'v1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { slug: 'v1' } });
  });

  it('adminGetProductUpdate throws NotFoundError', async () => {
    mockResourceQueries.findProductUpdateBySlug.mockResolvedValue(null);
    const run = makeHandler(resourceCtrl.adminGetProductUpdate);
    const { next } = await run({ params: { slug: 'missing' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('adminGetProductUpdate throws for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminGetProductUpdate);
    const { next } = await run({ params: { slug: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminCreateProductUpdate creates', async () => {
    mockResourceMutations.createProductUpdate.mockResolvedValue({ slug: 'v2' });
    const run = makeHandler(resourceCtrl.adminCreateProductUpdate);
    const { res } = await run({
      user: { id: 'admin' },
      body: { title: 'V2', date: '2025-01-15', description: 'New', version: '2.0.0' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('adminCreateProductUpdate throws ValidationError', async () => {
    const run = makeHandler(resourceCtrl.adminCreateProductUpdate);
    const { next } = await run({ user: { id: 'admin' }, body: { title: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminUpdateProductUpdate updates', async () => {
    mockResourceMutations.updateProductUpdate.mockResolvedValue({ slug: 'v1' });
    const run = makeHandler(resourceCtrl.adminUpdateProductUpdate);
    const { res } = await run({ params: { slug: 'v1' }, body: { title: 'Updated' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Product update saved' }));
  });

  it('adminUpdateProductUpdate throws for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminUpdateProductUpdate);
    const { next } = await run({ params: { slug: '' }, body: { title: 'x' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('adminDeleteProductUpdate deletes', async () => {
    mockResourceMutations.deleteProductUpdate.mockResolvedValue(undefined);
    const run = makeHandler(resourceCtrl.adminDeleteProductUpdate);
    const { res } = await run({ params: { slug: 'v1' } });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('adminDeleteProductUpdate throws for empty slug', async () => {
    const run = makeHandler(resourceCtrl.adminDeleteProductUpdate);
    const { next } = await run({ params: { slug: '' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('publicListPopularResources lists', async () => {
    mockResourceQueries.findPublicPopularResources.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.publicListPopularResources);
    const { res } = await run({ query: {} });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [], total: 0 } });
  });

  it('publicListPopularResources passes category and pagination', async () => {
    mockResourceQueries.findPublicPopularResources.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.publicListPopularResources);
    await run({ query: { category: 'guides', page: '2', limit: '4' } });
    expect(mockResourceQueries.findPublicPopularResources).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'guides', page: 2, limit: 4 }),
    );
  });

  it('publicGetPopularResource returns by slug', async () => {
    mockResourceQueries.findPublicPopularResourceBySlug.mockResolvedValue({ slug: 'pub' });
    const run = makeHandler(resourceCtrl.publicGetPopularResource);
    const { res } = await run({ params: { slug: 'pub' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { slug: 'pub' } });
  });

  it('publicGetPopularResource throws NotFoundError', async () => {
    mockResourceQueries.findPublicPopularResourceBySlug.mockResolvedValue(null);
    const run = makeHandler(resourceCtrl.publicGetPopularResource);
    const { next } = await run({ params: { slug: 'missing' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('publicListProductUpdates lists', async () => {
    mockResourceQueries.findPublicProductUpdates.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.publicListProductUpdates);
    const { res } = await run({ query: {} });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [], total: 0 } });
  });

  it('publicListProductUpdates passes pagination', async () => {
    mockResourceQueries.findPublicProductUpdates.mockResolvedValue({ items: [], total: 0 });
    const run = makeHandler(resourceCtrl.publicListProductUpdates);
    await run({ query: { page: '3', limit: '10' } });
    expect(mockResourceQueries.findPublicProductUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 10 }),
    );
  });

  it('publicGetProductUpdate returns by slug', async () => {
    mockResourceQueries.findPublicProductUpdateBySlug.mockResolvedValue({ slug: 'v1' });
    const run = makeHandler(resourceCtrl.publicGetProductUpdate);
    const { res } = await run({ params: { slug: 'v1' } });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { slug: 'v1' } });
  });

  it('publicGetProductUpdate throws NotFoundError', async () => {
    mockResourceQueries.findPublicProductUpdateBySlug.mockResolvedValue(null);
    const run = makeHandler(resourceCtrl.publicGetProductUpdate);
    const { next } = await run({ params: { slug: 'missing' } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. resource.validation.ts — import ACTUAL module
// ═══════════════════════════════════════════════════════════════════════════════

describe('resource.validation.ts', () => {
  let mod: typeof import('../../modules/resource/resource.validation.js');

  beforeEach(async () => {
    mod = await vi.importActual<typeof import('../../modules/resource/resource.validation.js')>(
      '../../modules/resource/resource.validation.js',
    );
  });

  it('resourceStatusSchema accepts valid statuses', () => {
    expect(mod.resourceStatusSchema.parse('DRAFT')).toBe('DRAFT');
    expect(mod.resourceStatusSchema.parse('PUBLIC')).toBe('PUBLIC');
    expect(mod.resourceStatusSchema.parse('ARCHIVE')).toBe('ARCHIVE');
  });

  it('resourceStatusSchema rejects invalid status', () => {
    expect(() => mod.resourceStatusSchema.parse('INVALID')).toThrow();
  });

  it('createPopularResourceSchema accepts valid input', () => {
    const result = mod.createPopularResourceSchema.parse({
      title: 'R', description: 'D', image: 'https://example.com/img.png', category: 'cat',
    });
    expect(result.status).toBe('DRAFT');
  });

  it('createPopularResourceSchema accepts with explicit status', () => {
    const result = mod.createPopularResourceSchema.parse({
      title: 'R', description: 'D', image: 'https://example.com/img.png', category: 'cat', status: 'PUBLIC',
    });
    expect(result.status).toBe('PUBLIC');
  });

  it('createPopularResourceSchema rejects missing title', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      description: 'D', image: 'https://example.com/img.png', category: 'cat',
    })).toThrow();
  });

  it('createPopularResourceSchema rejects empty title', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      title: '', description: 'D', image: 'https://example.com/img.png', category: 'cat',
    })).toThrow();
  });

  it('createPopularResourceSchema rejects missing description', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      title: 'T', image: 'https://example.com/img.png', category: 'cat',
    })).toThrow();
  });

  it('createPopularResourceSchema rejects invalid image URL', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      title: 'T', description: 'D', image: 'not-a-url', category: 'cat',
    })).toThrow();
  });

  it('createPopularResourceSchema rejects missing category', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      title: 'T', description: 'D', image: 'https://example.com/img.png',
    })).toThrow();
  });

  it('createPopularResourceSchema rejects invalid status enum', () => {
    expect(() => mod.createPopularResourceSchema.parse({
      title: 'T', description: 'D', image: 'https://example.com/img.png', category: 'c', status: 'BAD',
    })).toThrow();
  });

  it('updatePopularResourceSchema accepts partial', () => {
    const result = mod.updatePopularResourceSchema.parse({ title: 'U' });
    expect(result).toEqual(expect.objectContaining({ title: 'U' }));
  });

  it('updatePopularResourceSchema accepts empty', () => {
    const result = mod.updatePopularResourceSchema.parse({});
    expect(result).toEqual(expect.objectContaining({}));
  });

  it('updatePopularResourceSchema validates fields when provided', () => {
    expect(() => mod.updatePopularResourceSchema.parse({ image: 'not-url' })).toThrow();
  });

  it('popularResourceListQuerySchema applies defaults', () => {
    const r = mod.popularResourceListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(8);
  });

  it('popularResourceListQuerySchema coerces strings', () => {
    const r = mod.popularResourceListQuerySchema.parse({ page: '3', limit: '20' });
    expect(r.page).toBe(3);
    expect(r.limit).toBe(20);
  });

  it('popularResourceListQuerySchema rejects limit > 100', () => {
    expect(() => mod.popularResourceListQuerySchema.parse({ limit: '101' })).toThrow();
  });

  it('popularResourceListQuerySchema rejects negative page', () => {
    expect(() => mod.popularResourceListQuerySchema.parse({ page: '-1' })).toThrow();
  });

  it('popularResourceListQuerySchema accepts valid status filter', () => {
    expect(mod.popularResourceListQuerySchema.parse({ status: 'PUBLIC' }).status).toBe('PUBLIC');
  });

  it('createProductUpdateSchema accepts valid input', () => {
    const r = mod.createProductUpdateSchema.parse({
      title: 'V2', date: '2025-01-15', description: 'New', version: '2.0.0',
    });
    expect(r.status).toBe('DRAFT');
    expect(r.date).toBeInstanceOf(Date);
  });

  it('createProductUpdateSchema rejects missing title', () => {
    expect(() => mod.createProductUpdateSchema.parse({
      date: '2025-01-15', description: 'D', version: '1.0',
    })).toThrow();
  });

  it('createProductUpdateSchema rejects invalid date', () => {
    expect(() => mod.createProductUpdateSchema.parse({
      title: 'T', date: 'not-a-date', description: 'D', version: '1.0',
    })).toThrow();
  });

  it('createProductUpdateSchema rejects missing version', () => {
    expect(() => mod.createProductUpdateSchema.parse({
      title: 'T', date: '2025-01-15', description: 'D',
    })).toThrow();
  });

  it('createProductUpdateSchema rejects missing description', () => {
    expect(() => mod.createProductUpdateSchema.parse({
      title: 'T', date: '2025-01-15', version: '1.0',
    })).toThrow();
  });

  it('createProductUpdateSchema accepts Date object', () => {
    const r = mod.createProductUpdateSchema.parse({
      title: 'T', date: new Date('2025-06-01'), description: 'D', version: '1.0',
    });
    expect(r.date).toBeInstanceOf(Date);
  });

  it('updateProductUpdateSchema accepts partial', () => {
    const result = mod.updateProductUpdateSchema.parse({ title: 'U' });
    expect(result).toEqual(expect.objectContaining({ title: 'U' }));
  });

  it('updateProductUpdateSchema accepts empty', () => {
    const result = mod.updateProductUpdateSchema.parse({});
    expect(result).toEqual(expect.objectContaining({}));
  });

  it('productUpdateListQuerySchema applies defaults', () => {
    const r = mod.productUpdateListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it('productUpdateListQuerySchema coerces strings', () => {
    const r = mod.productUpdateListQuerySchema.parse({ page: '2', limit: '50' });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(50);
  });

  it('productUpdateListQuerySchema rejects limit > 100', () => {
    expect(() => mod.productUpdateListQuerySchema.parse({ limit: '200' })).toThrow();
  });

  it('resourceSlugParamSchema accepts valid slug', () => {
    expect(mod.resourceSlugParamSchema.parse({ slug: 'my-resource' })).toEqual({ slug: 'my-resource' });
  });

  it('resourceSlugParamSchema rejects empty slug', () => {
    expect(() => mod.resourceSlugParamSchema.parse({ slug: '' })).toThrow();
  });

  it('resourceSlugParamSchema rejects missing slug', () => {
    expect(() => mod.resourceSlugParamSchema.parse({})).toThrow();
  });

  it('validate middleware calls next() on valid body', () => {
    const req = { body: { title: 'T', description: 'D', image: 'https://example.com/img.png', category: 'c' } } as any;
    const res = {} as any;
    const next = vi.fn();
    mod.validate(mod.createPopularResourceSchema, 'body')(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body.status).toBe('DRAFT');
  });

  it('validate middleware calls next with ValidationError on invalid body', () => {
    const req = { body: { title: '' } } as any;
    const res = {} as any;
    const next = vi.fn();
    mod.validate(mod.createPopularResourceSchema, 'body')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError', statusCode: 400 }));
  });

  it('validate middleware stores validated query', () => {
    const req = { query: { page: '2', limit: '10' } } as any;
    const res = {} as any;
    const next = vi.fn();
    mod.validate(mod.popularResourceListQuerySchema, 'query')(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.validatedQuery).toEqual(expect.objectContaining({ page: 2, limit: 10 }));
  });

  it('validate middleware stores validated params', () => {
    const req = { params: { slug: 'test-slug' } } as any;
    const res = {} as any;
    const next = vi.fn();
    mod.validate(mod.resourceSlugParamSchema, 'params')(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.validatedParams).toEqual({ slug: 'test-slug' });
  });

  it('validate middleware passes non-ZodError to next', () => {
    const req = { body: null } as any;
    const res = {} as any;
    const next = vi.fn();
    const throwSchema = { parse: () => { throw new Error('random'); } };
    mod.validate(throwSchema as any, 'body')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
