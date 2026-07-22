import { describe, it, expect, vi } from 'vitest';
import { TaskFilters } from '../../../modules/task/task.filters.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspaceMember: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Task Filters', () => {
  const mockUserId = 'user-1';
  const mockWorkspaceId = 'ws-1';

  describe('buildProjectFilter', () => {
    it('should return project filter', () => {
      const filters = { projectId: 'proj-1' } as any;
      expect(TaskFilters.buildProjectFilter(filters)).toEqual({ projectId: 'proj-1' });
    });
  });

  describe('buildPersonalTasksFilter', () => {
    it('should handle "personal" type', () => {
      const filters = { type: 'personal', userId: mockUserId } as any;
      expect(TaskFilters.buildPersonalTasksFilter(filters)).toEqual({
        projectId: null,
        createdById: mockUserId,
      });
    });

    it('should handle "assigned" type', () => {
      const filters = { type: 'assigned', userId: mockUserId } as any;
      expect(TaskFilters.buildPersonalTasksFilter(filters)).toEqual({
        assignees: { some: { userId: mockUserId } },
      });
    });

    it('should handle "created" type', () => {
      const filters = { type: 'created', userId: mockUserId } as any;
      expect(TaskFilters.buildPersonalTasksFilter(filters)).toEqual({
        createdById: mockUserId,
      });
    });

    it('should handle default type', () => {
      const filters = { type: 'all', userId: mockUserId } as any;
      expect(TaskFilters.buildPersonalTasksFilter(filters)).toEqual({
        OR: [
          { createdById: mockUserId },
          { assignees: { some: { userId: mockUserId } } },
        ],
      });
    });
  });

  describe('buildWorkspaceTasksFilter', () => {
    it('should throw if workspaceId is missing', async () => {
      await expect(TaskFilters.buildWorkspaceTasksFilter({ userId: mockUserId } as any))
        .rejects.toThrow('workspaceId is required for workspace filter');
    });

    it('should allow admin to see all workspace tasks', async () => {
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ role: 'ADMIN' });
      const filters = { workspaceId: mockWorkspaceId, userId: mockUserId } as any;
      const result = await TaskFilters.buildWorkspaceTasksFilter(filters);
      expect(result).toEqual({
        OR: [
          { workspaceId: mockWorkspaceId },
          { project: { workspaceId: mockWorkspaceId } },
        ],
      });
    });

    it('should filter by involvement for regular members', async () => {
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ role: 'MEMBER' });
      const filters = { workspaceId: mockWorkspaceId, userId: mockUserId } as any;
      const result = await TaskFilters.buildWorkspaceTasksFilter(filters);
      expect(result).toEqual({
        AND: [
          {
            OR: [
              { workspaceId: mockWorkspaceId },
              { project: { workspaceId: mockWorkspaceId } },
            ],
          },
          {
            OR: [
              { createdById: mockUserId },
              { assignees: { some: { userId: mockUserId } } },
              {
                project: {
                  AND: [
                    { workspaceId: mockWorkspaceId },
                    { members: { some: { userId: mockUserId } } },
                  ],
                },
              },
            ],
          },
        ],
      });
    });

    it('should handle "assigned" type for members', async () => {
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ role: 'MEMBER' });
      const filters = { workspaceId: mockWorkspaceId, userId: mockUserId, type: 'assigned' } as any;
      const result = await TaskFilters.buildWorkspaceTasksFilter(filters);
      expect(result).toEqual({
        AND: [
          {
            OR: [
              { workspaceId: mockWorkspaceId },
              { project: { workspaceId: mockWorkspaceId } },
            ],
          },
          { assignees: { some: { userId: mockUserId } } },
        ],
      });
    });
  });

  describe('applyAdditionalFilters', () => {
    it('should apply status, priority, and labels', () => {
      const where = { id: '1' };
      const filters = { 
        status: 'TODO', 
        priority: 'HIGH', 
        labelIds: ['l1', 'l2'] 
      } as any;
      const result = TaskFilters.applyAdditionalFilters(where, filters);
      expect(result.status).toBe('TODO');
      expect(result.priority).toBe('HIGH');
      expect(result.labels).toEqual({ some: { labelId: { in: ['l1', 'l2'] } } });
    });
  });

  describe('applySearchFilter', () => {
    it('should add search conditions to simple where', () => {
      const where = { status: 'TODO' };
      const result = TaskFilters.applySearchFilter(where, 'test');
      expect(result).toEqual({
        status: 'TODO',
        OR: [
          { title: { contains: 'test', mode: 'insensitive' } },
          { description: { contains: 'test', mode: 'insensitive' } },
        ],
      });
    });

    it("should add search conditions to AND where", () => {
      const where = { AND: [{ priority: 'HIGH' }] };
      const result = TaskFilters.applySearchFilter(where, 'test') as any;
      expect(result.AND).toHaveLength(2);
      expect(result.AND[1].OR[0].title.contains).toBe('test');
    });

  });

  describe('buildOrderBy', () => {
    it('should build order for dueDate', () => {
      const order = TaskFilters.buildOrderBy('dueDate', 'asc');
      expect(order).toEqual([
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ]);
    });

    it('should build order for priority', () => {
      const order = TaskFilters.buildOrderBy('priority', 'desc');
      expect(order).toEqual([
        { priority: 'desc' },
        { dueDate: { sort: 'asc', nulls: 'last' } },
      ]);
    });
  });
});
