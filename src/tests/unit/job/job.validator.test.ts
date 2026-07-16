import { describe, it, expect } from 'vitest';
import {
  createJobSchema,
  updateJobSchema,
  listJobsQuerySchema,
} from '../../../modules/job/job.validator.js';

describe('job.validator', () => {
  const validCreateInput = {
    title: 'Senior Engineer',
    department: 'ENGINEERING',
    location: 'San Francisco',
    description: 'We are looking for a senior engineer to join our team and build amazing products.',
    requirements: 'Must have 5+ years of experience with TypeScript and Node.js.',
  };

  describe('createJobSchema', () => {
    it('should accept valid minimal input', () => {
      const result = createJobSchema.safeParse(validCreateInput);
      expect(result.success).toBe(true);
    });

    it('should accept with all optional fields', () => {
      const result = createJobSchema.safeParse({
        ...validCreateInput,
        locationType: 'HYBRID',
        type: 'FULL_TIME',
        experienceLevel: 'SENIOR',
        salaryMin: 100000,
        salaryMax: 150000,
        salaryCurrency: 'USD',
        niceToHave: 'AWS experience',
        benefits: 'Health insurance',
        status: 'OPEN',
        closingDate: '2026-12-31',
        applicationUrl: 'https://apply.example.com',
        applicationEmail: 'hr@example.com',
        isPinned: true,
      });
      expect(result.success).toBe(true);
    });

    it('should default locationType to REMOTE', () => {
      const result = createJobSchema.safeParse(validCreateInput);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.locationType).toBe('REMOTE');
    });

    it('should default status to DRAFT', () => {
      const result = createJobSchema.safeParse(validCreateInput);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('DRAFT');
    });

    it('should reject title under 3 chars', () => {
      const result = createJobSchema.safeParse({ ...validCreateInput, title: 'AB' });
      expect(result.success).toBe(false);
    });

    it('should reject title over 150 chars', () => {
      const result = createJobSchema.safeParse({ ...validCreateInput, title: 'x'.repeat(151) });
      expect(result.success).toBe(false);
    });

    it('should reject description under 50 chars', () => {
      const result = createJobSchema.safeParse({ ...validCreateInput, description: 'Short' });
      expect(result.success).toBe(false);
    });

    it('should reject requirements under 20 chars', () => {
      const result = createJobSchema.safeParse({ ...validCreateInput, requirements: 'Short' });
      expect(result.success).toBe(false);
    });

    it('should reject salaryMax less than salaryMin', () => {
      const result = createJobSchema.safeParse({
        ...validCreateInput,
        salaryMin: 100000,
        salaryMax: 50000,
      });
      expect(result.success).toBe(false);
    });

    it('should accept salaryMax equal to salaryMin', () => {
      const result = createJobSchema.safeParse({
        ...validCreateInput,
        salaryMin: 100000,
        salaryMax: 100000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept all valid departments', () => {
      const depts = ['ENGINEERING', 'DESIGN', 'PRODUCT', 'MARKETING', 'SALES', 'CUSTOMER_SUCCESS', 'OPERATIONS', 'FINANCE', 'HR', 'OTHER'];
      for (const dept of depts) {
        expect(createJobSchema.safeParse({ ...validCreateInput, department: dept }).success).toBe(true);
      }
    });

    it('should reject invalid department', () => {
      const result = createJobSchema.safeParse({ ...validCreateInput, department: 'INVALID' });
      expect(result.success).toBe(false);
    });
  });

  describe('updateJobSchema', () => {
    it('should accept empty object (all fields optional)', () => {
      const result = updateJobSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial updates', () => {
      const result = updateJobSchema.safeParse({ title: 'Updated Title' });
      expect(result.success).toBe(true);
    });
  });

  describe('listJobsQuerySchema', () => {
    it('should accept empty query', () => {
      const result = listJobsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should default page to 1', () => {
      const result = listJobsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBe(1);
    });

    it('should default limit to 20', () => {
      const result = listJobsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(20);
    });

    it('should accept search filter', () => {
      const result = listJobsQuerySchema.safeParse({ search: 'engineer' });
      expect(result.success).toBe(true);
    });

    it('should reject limit over 50', () => {
      const result = listJobsQuerySchema.safeParse({ limit: '51' });
      expect(result.success).toBe(false);
    });
  });
});
