import { prisma }              from '../../lib/prisma.js';
import type { CreateJobInput,
              UpdateJobInput,
              ListJobsQuery }  from './job.validator.js';

// ─── Slug helper ──────────────────────────────────────────────────────────────
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug      = base;
  let attempt   = 0;

  while (true) {
    const existing = await prisma.jobPosting.findUnique({
      where : { slug },
      select: { id: true },
    });

    if (!existing || existing.id === excludeId) return slug;

    attempt += 1;
    slug = `${base}-${attempt}`;
  }
}

// ─── Public: list open jobs ───────────────────────────────────────────────────
export async function listOpenJobs(query: ListJobsQuery) {
  const { department, locationType, type, search, page, limit } = query;
  const skip = (page - 1) * limit;

  const where = {
    status: 'OPEN' as const,
    ...(department   ? { department }   : {}),
    ...(locationType ? { locationType } : {}),
    ...(type         ? { type }         : {}),
    ...(search
      ? {
          OR: [
            { title      : { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
            { location   : { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [jobs, total] = await Promise.all([
    prisma.jobPosting.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
      skip,
      take: limit,
      select: {
        id             : true,
        title          : true,
        slug           : true,
        description    : true,
        department     : true,
        location       : true,
        locationType   : true,
        type           : true,
        experienceLevel: true,
        salaryMin      : true,
        salaryMax      : true,
        salaryCurrency : true,
        isPinned       : true,
        closingDate    : true,
        publishedAt    : true,
        createdAt      : true,
        updatedAt      : true,
        applicationUrl : true,
        applicationEmail: true,
      },
    }),
    prisma.jobPosting.count({ where }),
  ]);

  return { jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ─── Public: get single open job ─────────────────────────────────────────────
export async function getOpenJob(slug: string) {
  return prisma.jobPosting.findFirst({
    where: { slug, status: 'OPEN' },
  });
}

// ─── Admin: create job ────────────────────────────────────────────────────────
export async function createJob(data: CreateJobInput, postedById: string) {
  const baseSlug = toSlug(data.title);
  const slug     = await uniqueSlug(baseSlug);

  return prisma.jobPosting.create({
    data: {
      ...data,
      slug,
      postedById,
      applicationEmail: data.applicationEmail ?? process.env.SUPPORT_EMAIL ?? 'careers@focura.app',
      publishedAt     : data.status === 'OPEN' ? new Date() : null,
    },
  });
}

// ─── Admin: update job ────────────────────────────────────────────────────────
export async function updateJob(id: string, data: UpdateJobInput) {
  const existing = await prisma.jobPosting.findUniqueOrThrow({ where: { id } });

  // Regenerate slug only if title changed
  let slug = existing.slug;
  if (data.title && data.title !== existing.title) {
    slug = await uniqueSlug(toSlug(data.title), id);
  }

  // Set publishedAt when transitioning to OPEN for the first time
  const publishedAt =
    !existing.publishedAt && data.status === 'OPEN' ? new Date() : existing.publishedAt;

  return prisma.jobPosting.update({
    where: { id },
    data : { ...data, slug, publishedAt },
  });
}

// ─── Admin: delete job ────────────────────────────────────────────────────────
export async function deleteJob(id: string) {
  return prisma.jobPosting.delete({ where: { id } });
}

// ─── Admin: list all jobs (any status) ───────────────────────────────────────
export async function listAllJobs(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [jobs, total] = await Promise.all([
    prisma.jobPosting.findMany({
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.jobPosting.count(),
  ]);

  return { jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ─── Admin: toggle pin ────────────────────────────────────────────────────────
export async function togglePin(id: string) {
  const job = await prisma.jobPosting.findUniqueOrThrow({ where: { id }, select: { isPinned: true } });
  return prisma.jobPosting.update({ where: { id }, data: { isPinned: !job.isPinned } });
}