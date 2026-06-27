import { describe, it, expect } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FeatureService } from '../../../modules/feature/feature.service.js';
import { FeatureRepository } from '../../../modules/feature/feature.repository.js';
import { createUser, createAdminUser, createFeatureRequest } from '../../factories/index.js';
import { NotFoundError, ForbiddenError } from '../../../errors/index.js';
import { FeatureStatus, VoteType } from '@prisma/client';

describe('FeatureService & FeatureRepository Unit Tests', () => {

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Create Feature Request
  // ─────────────────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a feature request successfully with expected defaults', async () => {
      const user = await createUser();
      const input = {
        title: 'Integrate Slack notifications',
        description: 'Send daily digests and real-time project alerts directly to Slack channels.',
        createdById: user.id,
      };

      const result = await FeatureService.create(input);

      expect(result.id).toBeDefined();
      expect(result.title).toBe(input.title);
      expect(result.description).toBe(input.description);
      expect(result.status).toBe(FeatureStatus.PENDING);
      expect(result.adminNote).toBeNull();
      expect(result.createdBy.id).toBe(user.id);
      expect(result.createdBy.name).toBe(user.name);
      expect(result._count.upvotes).toBe(0);
      expect(result._count.downvotes).toBe(0);
      expect(result.userVote).toBeNull();

      // Verify database record
      const dbRecord = await prisma.featureRequest.findUnique({
        where: { id: result.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.title).toBe(input.title);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Get One Feature Request
  // ─────────────────────────────────────────────────────────────────────────────
  describe('getOne / findById', () => {
    it('retrieves a feature request with computed upvotes/downvotes/userVote', async () => {
      const userA = await createUser();
      const userB = await createUser();
      const feature = await createFeatureRequest(userA.id, {
        title: 'Dark Mode Support',
        description: 'A dark background option',
      });

      // User A upvotes
      await prisma.featureVote.create({
        data: { userId: userA.id, featureRequestId: feature.id, type: VoteType.UP },
      });
      // User B downvotes
      await prisma.featureVote.create({
        data: { userId: userB.id, featureRequestId: feature.id, type: VoteType.DOWN },
      });

      // Retrieve as User A
      const resultAsA = await FeatureService.getOne(feature.id, userA.id);
      expect(resultAsA.id).toBe(feature.id);
      expect(resultAsA._count.upvotes).toBe(1);
      expect(resultAsA._count.downvotes).toBe(1);
      expect(resultAsA.userVote).toBe(VoteType.UP);

      // Retrieve as User B
      const resultAsB = await FeatureService.getOne(feature.id, userB.id);
      expect(resultAsB.userVote).toBe(VoteType.DOWN);
    });

    it('throws NotFoundError for non-existent feature requests', async () => {
      const user = await createUser();
      await expect(
        FeatureService.getOne('cmqqqqqqqqqqqqqqqqqqqqqqq', user.id)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Get Many / findMany
  // ─────────────────────────────────────────────────────────────────────────────
  describe('getMany / findMany', () => {
    it('returns paginated feature requests with correct metadata', async () => {
      const user = await createUser();
      await createFeatureRequest(user.id, { title: 'Feature 1' });
      await createFeatureRequest(user.id, { title: 'Feature 2' });
      await createFeatureRequest(user.id, { title: 'Feature 3' });

      const result = await FeatureService.getMany({ page: 1, pageSize: 2 }, user.id);

      expect(result.data).toHaveLength(2);
      expect(result.pagination.totalCount).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('filters feature requests by status', async () => {
      const user = await createUser();
      const f1 = await createFeatureRequest(user.id, { title: 'Feature 1' });
      const f2 = await createFeatureRequest(user.id, { title: 'Feature 2' });

      // Approve f2
      await prisma.featureRequest.update({
        where: { id: f2.id },
        data: { status: FeatureStatus.APPROVED },
      });

      const pendingResult = await FeatureService.getMany({ status: FeatureStatus.PENDING }, user.id);
      expect(pendingResult.data.map(f => f.id)).toContain(f1.id);
      expect(pendingResult.data.map(f => f.id)).not.toContain(f2.id);

      const approvedResult = await FeatureService.getMany({ status: FeatureStatus.APPROVED }, user.id);
      expect(approvedResult.data.map(f => f.id)).toContain(f2.id);
      expect(approvedResult.data.map(f => f.id)).not.toContain(f1.id);
    });

    it('searches features by title and description case-insensitively', async () => {
      const user = await createUser();
      await createFeatureRequest(user.id, { title: 'Calendar Integration', description: 'desc' });
      await createFeatureRequest(user.id, { title: 'Toodledo integration', description: 'connect calendar and tasks' });
      await createFeatureRequest(user.id, { title: 'Unrelated request', description: 'unrelated' });

      // Search title "integration"
      const result1 = await FeatureService.getMany({ search: 'INTEGRATION' }, user.id);
      expect(result1.data).toHaveLength(2);
      expect(result1.data.map(f => f.title)).toContain('Calendar Integration');
      expect(result1.data.map(f => f.title)).toContain('Toodledo integration');

      // Search description "calendar"
      const result2 = await FeatureService.getMany({ search: 'calendar' }, user.id);
      expect(result2.data).toHaveLength(2);
      expect(result2.data.map(f => f.title)).toContain('Calendar Integration');
      expect(result2.data.map(f => f.title)).toContain('Toodledo integration');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Update Feature Status
  // ─────────────────────────────────────────────────────────────────────────────
  describe('updateStatus', () => {
    it('allows admins to update status and add admin notes', async () => {
      const admin = await createAdminUser();
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      const result = await FeatureService.updateStatus(feature.id, admin.id, {
        status: FeatureStatus.PLANNED,
        adminNote: 'We are starting implementation in Q3.',
      });

      expect(result.status).toBe(FeatureStatus.PLANNED);
      expect(result.adminNote).toBe('We are starting implementation in Q3.');

      const dbRecord = await prisma.featureRequest.findUnique({ where: { id: feature.id } });
      expect(dbRecord?.status).toBe(FeatureStatus.PLANNED);
      expect(dbRecord?.adminNote).toBe('We are starting implementation in Q3.');
    });

    it('denies status updates by non-admins', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await expect(
        FeatureService.updateStatus(feature.id, user.id, {
          status: FeatureStatus.APPROVED,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when trying to update non-existent feature request', async () => {
      const admin = await createAdminUser();
      await expect(
        FeatureService.updateStatus('cmqqqqqqqqqqqqqqqqqqqqqqq', admin.id, {
          status: FeatureStatus.APPROVED,
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Delete Feature Request
  // ─────────────────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('allows admins to delete a feature request', async () => {
      const admin = await createAdminUser();
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await FeatureService.delete(feature.id, admin.id);

      const dbRecord = await prisma.featureRequest.findUnique({ where: { id: feature.id } });
      expect(dbRecord).toBeNull();
    });

    it('denies deletion by non-admins', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await expect(
        FeatureService.delete(feature.id, user.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when deleting non-existent feature request', async () => {
      const admin = await createAdminUser();
      await expect(
        FeatureService.delete('cmqqqqqqqqqqqqqqqqqqqqqqq', admin.id)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Casting Votes (idempotency, change, and counts)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('vote', () => {
    it('casts a new vote and returns counts and userVote correctly', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      const result = await FeatureService.vote(feature.id, user.id, VoteType.UP);

      expect(result.action).toBe('created');
      expect(result.feature?.id).toBe(feature.id);
      expect(result.feature?._count.upvotes).toBe(1);
      expect(result.feature?.userVote).toBe(VoteType.UP);
    });

    it('changing a vote updates type and action status', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      // 1st vote: UP
      await FeatureService.vote(feature.id, user.id, VoteType.UP);

      // 2nd vote: DOWN
      const result = await FeatureService.vote(feature.id, user.id, VoteType.DOWN);
      expect(result.action).toBe('updated');
      expect(result.feature?._count.upvotes).toBe(0);
      expect(result.feature?._count.downvotes).toBe(1);
      expect(result.feature?.userVote).toBe(VoteType.DOWN);
    });

    it('casting the same vote is idempotent and does not change counts', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await FeatureService.vote(feature.id, user.id, VoteType.UP);

      const result = await FeatureService.vote(feature.id, user.id, VoteType.UP);
      expect(result.action).toBe('unchanged');
      expect(result.feature?._count.upvotes).toBe(1);
      expect(result.feature?.userVote).toBe(VoteType.UP);
    });

    it('throws NotFoundError when voting on a non-existent feature', async () => {
      const user = await createUser();
      await expect(
        FeatureService.vote('cmqqqqqqqqqqqqqqqqqqqqqqq', user.id, VoteType.UP)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Removing Votes
  // ─────────────────────────────────────────────────────────────────────────────
  describe('removeVote', () => {
    it('removes a cast vote and resets the counts', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await FeatureService.vote(feature.id, user.id, VoteType.UP);

      // Verify vote exists
      let dbVote = await prisma.featureVote.findUnique({
        where: { userId_featureRequestId: { userId: user.id, featureRequestId: feature.id } },
      });
      expect(dbVote).not.toBeNull();

      await FeatureService.removeVote(feature.id, user.id);

      // Verify vote is removed
      dbVote = await prisma.featureVote.findUnique({
        where: { userId_featureRequestId: { userId: user.id, featureRequestId: feature.id } },
      });
      expect(dbVote).toBeNull();
    });

    it('throws NotFoundError when removing a vote that does not exist', async () => {
      const user = await createUser();
      const feature = await createFeatureRequest(user.id);

      await expect(
        FeatureService.removeVote(feature.id, user.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
