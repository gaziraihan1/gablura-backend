import { NotFoundError } from '../../errors/AppError.js';
import { prisma } from '../../lib/prisma.js';
import { CacheClient } from '../../lib/redis/cache.client.js';
import type {
  CreateFeatureRequestInput,
  UpdateFeatureStatusInput,
  FeatureFilterParams,
  FeatureRequestResult,
  PaginatedFeatureRequestsResult,
  VoteType,
} from './feature.types.js';

const createdBySelect = {
  select: { id: true, name: true, image: true },
} as const;

// ─── Map raw Prisma row → FeatureRequestResult ────────────────────────────────

function mapFeature(
  raw: any,
  userId: string | null,
): FeatureRequestResult {
  const upvotes   = raw.votes?.filter((v: any) => v.type === 'UP').length   ?? 0;
  const downvotes = raw.votes?.filter((v: any) => v.type === 'DOWN').length ?? 0;
  const userVote  = userId
    ? (raw.votes?.find((v: any) => v.userId === userId)?.type ?? null)
    : null;

  return {
    id:          raw.id,
    title:       raw.title,
    description: raw.description,
    status:      raw.status,
    adminNote:   raw.adminNote ?? null,
    createdAt:   raw.createdAt,
    updatedAt:   raw.updatedAt,
    createdBy: {
      id:    raw.createdBy.id,
      name:  raw.createdBy.name  ?? 'Unknown',
      image: raw.createdBy.image ?? null,
    },
    _count: { upvotes, downvotes },
    userVote,
  };
}

export const FeatureRepository = {
  async create(input: CreateFeatureRequestInput): Promise<FeatureRequestResult> {
    const raw = await prisma.featureRequest.create({
      data: {
        title:       input.title,
        description: input.description,
        createdById: input.createdById,
      },
      include: {
        createdBy: createdBySelect,
        votes:     { select: { userId: true, type: true } },
      },
    });
    return mapFeature(raw, input.createdById);
  },

  async findMany(
    params: FeatureFilterParams,
    userId: string | null,
  ): Promise<PaginatedFeatureRequestsResult> {
    const page     = Math.max(1, params.page     ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
    
    const cacheKey = `feature:list:${userId ?? 'guest'}:${params.status ?? 'all'}:${params.search ?? 'none'}:${page}:${pageSize}`;
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const skip = (page - 1) * pageSize;

        const where = {
          ...(params.status && { status: params.status }),
          ...(params.search && {
            OR: [
              { title:       { contains: params.search, mode: 'insensitive' as const } },
              { description: { contains: params.search, mode: 'insensitive' as const } },
            ],
          }),
        };

        const [rows, totalCount] = await Promise.all([
          prisma.featureRequest.findMany({
            where,
            include: {
              createdBy: createdBySelect,
              votes:     { select: { userId: true, type: true } },
            },
            orderBy: [{ createdAt: 'desc' }],
            skip,
            take: pageSize,
          }),
          prisma.featureRequest.count({ where }),
        ]);

        return {
          data: rows.map((r) => mapFeature(r, userId)),
          pagination: {
            page,
            pageSize,
            totalCount,
            totalPages: Math.ceil(totalCount / pageSize),
            hasNext:    page < Math.ceil(totalCount / pageSize),
            hasPrev:    page > 1,
          },
        };
      },
      300, // 5 min TTL
    );
  },

  async findById(id: string, userId: string | null): Promise<FeatureRequestResult | null> {
    const cacheKey = `feature:id:${id}:${userId ?? 'guest'}`;
    
    return CacheClient.getOrSet(
      cacheKey,
      async () => {
        const raw = await prisma.featureRequest.findUnique({
          where:   { id },
          include: {
            createdBy: createdBySelect,
            votes:     { select: { userId: true, type: true } },
          },
        });
        return raw ? mapFeature(raw, userId) : null;
      },
      600, // 10 min TTL
    );
  },

  async findByIdUncached(id: string, userId: string | null): Promise<FeatureRequestResult | null> {
    const raw = await prisma.featureRequest.findUnique({
      where:   { id },
      include: {
        createdBy: createdBySelect,
        votes:     { select: { userId: true, type: true } },
      },
    });
    return raw ? mapFeature(raw, userId) : null;
  },

  async updateStatus(id: string, input: UpdateFeatureStatusInput): Promise<FeatureRequestResult> {
    const raw = await prisma.featureRequest.update({
      where: { id },
      data:  { status: input.status, adminNote: input.adminNote ?? null },
      include: {
        createdBy: createdBySelect,
        votes:     { select: { userId: true, type: true } },
      },
    });
    
    await Promise.all([
      CacheClient.deletePattern(`feature:list:*`),
      CacheClient.deletePattern(`feature:id:${id}:*`),
    ]);
    
    return mapFeature(raw, null);
  },

  async delete(id: string): Promise<void> {
    await prisma.featureRequest.delete({ where: { id } });
    await Promise.all([
      CacheClient.deletePattern(`feature:list:*`),
      CacheClient.deletePattern(`feature:id:${id}:*`),
    ]);
  },

  // ── Vote: upsert (change vote type) or delete (retract) ──────────────────
  async vote(
    featureRequestId: string,
    userId:           string,
    type:             VoteType,
  ): Promise<'created' | 'updated' | 'retracted' | 'unchanged'> {
    const existing = await prisma.featureVote.findUnique({
      where: { userId_featureRequestId: { userId, featureRequestId } },
    });

    if (!existing) {
      await prisma.featureVote.create({
        data: { userId, featureRequestId, type },
      });
      await Promise.all([
        CacheClient.deletePattern(`feature:list:*`),
        CacheClient.deletePattern(`feature:id:${featureRequestId}:*`),
      ]);
      return 'created';
    }

    if (existing.type === type) {
      return 'unchanged';
    }

    await prisma.featureVote.update({
      where: { userId_featureRequestId: { userId, featureRequestId } },
      data: { type },
    });
    await Promise.all([
      CacheClient.deletePattern(`feature:list:*`),
      CacheClient.deletePattern(`feature:id:${featureRequestId}:*`),
    ]);
    return 'updated';
  },
  async removeVote(featureRequestId: string, userId: string): Promise<void> {
    const existing = await prisma.featureVote.findUnique({
      where: { userId_featureRequestId: { userId, featureRequestId } },
    });

    if (!existing) throw new NotFoundError("Vote")

    await prisma.featureVote.delete({
      where: { userId_featureRequestId: { userId, featureRequestId } },
    });
    await Promise.all([
      CacheClient.deletePattern(`feature:list:*`),
      CacheClient.deletePattern(`feature:id:${featureRequestId}:*`),
    ]);
  }
};