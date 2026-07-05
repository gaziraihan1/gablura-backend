import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import {
  listOpenJobs,
  getOpenJob,
  createJob,
  updateJob,
  deleteJob,
  listAllJobs,
  togglePin,
} from '../../../modules/job/job.service.js';
import { createUser, createJobPosting } from '../../factories/index.js';
import { JobStatus } from '@prisma/client';

describe('JobService', () => {
  beforeEach(async () => {
    await prisma.jobPosting.deleteMany();
  });

  it('listOpenJobs should return only open jobs', async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN, title: 'Open Job 1' });
    await createJobPosting(user.id, { status: JobStatus.OPEN, title: 'Open Job 2' });
    await createJobPosting(user.id, { status: JobStatus.CLOSED, title: 'Closed Job' });

    const result = await listOpenJobs({
      page: 1,
      limit: 10,
    });

    expect(result.jobs).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });

  it('listOpenJobs should filter by department', async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN, department: 'ENGINEERING' });
    await createJobPosting(user.id, { status: JobStatus.OPEN, department: 'MARKETING' });

    const result = await listOpenJobs({
      page: 1,
      limit: 10,
      department: 'ENGINEERING',
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].department).toBe('ENGINEERING');
  });

  it('listOpenJobs should search in title, description, and location', async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN, title: 'Frontend Developer' });
    await createJobPosting(user.id, { status: JobStatus.OPEN, description: 'Looking for a React expert' });
    await createJobPosting(user.id, { status: JobStatus.OPEN, location: 'New York' });
    await createJobPosting(user.id, { status: JobStatus.OPEN, title: 'Backend Developer' });

    const result = await listOpenJobs({
      page: 1,
      limit: 10,
      search: 'Developer',
    });

    expect(result.jobs).toHaveLength(2); // Frontend and Backend
  });

  it('getOpenJob should return a job by slug if it is open', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { status: JobStatus.OPEN, title: 'Unique Job' });
    
    const found = await getOpenJob(job.slug);
    expect(found).not.toBeNull();
    expect(found?.slug).toBe(job.slug);
  });

  it('getOpenJob should return null if job is closed', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { status: JobStatus.CLOSED });
    
    const found = await getOpenJob(job.slug);
    expect(found).toBeNull();
  });

  it('createJob should create a job and generate a slug', async () => {
    const user = await createUser();
    const jobData = {
      title: 'Software Engineer',
      description: 'Join us!',
      requirements: 'Experience with TypeScript',
      department: 'ENGINEERING' as any,
      location: 'Remote',
      locationType: 'REMOTE' as const,
      type: 'FULL_TIME' as const,
      experienceLevel: 'MID' as const,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryCurrency: 'USD',
      status: JobStatus.OPEN,
      isPinned: false
    };

    const job = await createJob(jobData, user.id);
    expect(job).toBeDefined();
    expect(job.slug).toBe('software-engineer');
    expect(job.postedById).toBe(user.id);
  });

  it('createJob should handle duplicate slugs by appending a number', async () => {
    const user = await createUser();
    await createJobPosting(user.id, { title: 'Software Engineer', slug: 'software-engineer' });
    
    const jobData = {
      title: 'Software Engineer',
      description: 'Join us!',
      requirements: 'Experience with TypeScript',
      department: 'ENGINEERING' as any,
      location: 'Remote',
      locationType: 'REMOTE' as const,
      type: 'FULL_TIME' as const,
      experienceLevel: 'MID' as const,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryCurrency: 'USD',
      status: JobStatus.OPEN,
      isPinned: false
    };

    const job = await createJob(jobData, user.id);
    expect(job.slug).toBe('software-engineer-1');
  });

  it('updateJob should update job details', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id);
    
    const updated = await updateJob(job.id, { title: 'Updated Title' });
    expect(updated.title).toBe('Updated Title');
    expect(updated.slug).toBe('updated-title');
  });

  it('updateJob should not change slug if title is unchanged', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { title: 'Stable Title' });
    const originalSlug = job.slug;
    
    const updated = await updateJob(job.id, { description: 'New description' });
    expect(updated.slug).toBe(originalSlug);
  });

  it('deleteJob should remove the job', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id);
    
    await deleteJob(job.id);
    const found = await prisma.jobPosting.findUnique({ where: { id: job.id } });
    expect(found).toBeNull();
  });

  it('listAllJobs should return all jobs regardless of status', async () => {
    const user = await createUser();
    await createJobPosting(user.id, { status: JobStatus.OPEN });
    await createJobPosting(user.id, { status: JobStatus.CLOSED });
    
    const result = await listAllJobs();
    // console.log(result)
    expect(result.jobs).toHaveLength(2);
  });

  it('togglePin should toggle the isPinned status', async () => {
    const user = await createUser();
    const job = await createJobPosting(user.id, { isPinned: false });
    
    const pinned = await togglePin(job.id);
    expect(pinned.isPinned).toBe(true);
    
    const unpinned = await togglePin(job.id);
    expect(unpinned.isPinned).toBe(false);
  });
});
