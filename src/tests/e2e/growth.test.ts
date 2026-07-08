import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { 
  createAdminUser 
} from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

describe('📈 Growth & Public Resources Journeys', () => {
  let adminUser: any;
  let adminHeaders: any;

  beforeEach(async () => {
    adminUser = await createAdminUser();
    adminHeaders = await authWithCsrfHeaders(adminUser);
  });

  it('should handle the "Job Posting" lifecycle', async () => {
    /**
     * JOURNEY:
     * 1. Admin creates a job posting
     * 2. Public user lists open jobs
     * 3. Public user views specific job
     * 4. Admin pins the job
     * 5. Admin updates the job
     * 6. Admin deletes the job
     */

    // 1. Create Job
    const createRes = await request(app)
  .post('/api/v1/jobs/admin')
  .set(adminHeaders)
  .send({
    title: 'Senior Backend Engineer',
    description: 'We are looking for a Node.js expert to join our growing team. You will be responsible for building scalable backend services and working with cross-functional teams to deliver high-quality software solutions.',
    requirements: 'At least 5 years of experience with Node.js, TypeScript, and PostgreSQL. Experience with AWS and microservices architecture is a plus.',
    department: 'ENGINEERING',
    location: 'Remote',
    locationType: 'REMOTE',
    type: 'FULL_TIME',
    experienceLevel: 'SENIOR',
    salaryMin: 100000,
    salaryMax: 150000,
    salaryCurrency: 'USD',
    status: 'OPEN',
  });

    expect(createRes.status).toBe(201);
    const job = createRes.body.data;

    // 2. Public List
    const listRes = await request(app).get('/api/v1/jobs');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((j: any) => j.slug === job.slug)).toBe(true);

    // 3. Public Get
    const getRes = await request(app).get(`/api/v1/jobs/${job.slug}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.title).toBe('Senior Backend Engineer');

    // 4. Pin Job
    const pinRes = await request(app)
      .patch(`/api/v1/jobs/admin/${job.id}/pin`)
      .set(adminHeaders);
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.data.isPinned).toBe(true);

    // 5. Update Job
    const updateRes = await request(app)
      .put(`/api/v1/jobs/admin/${job.id}`)
      .set(adminHeaders)
      .send({ title: 'Staff Backend Engineer' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe('Staff Backend Engineer');

    // 6. Delete Job
    const delRes = await request(app)
      .delete(`/api/v1/jobs/admin/${job.id}`)
      .set(adminHeaders);
    expect(delRes.status).toBe(200);
  });

  it('should handle the "Popular Resources" lifecycle', async () => {
    /**
     * JOURNEY:
     * 1. Admin creates a popular resource
     * 2. Public user lists popular resources
     * 3. Public user views the resource
     * 4. Admin updates the resource
     * 5. Admin deletes the resource
     */

    // 1. Create Resource
    const createRes = await request(app)
      .post('/api/v1/admin/resources/popular')
      .set(adminHeaders)
      .send({
        title: 'Best Node.js Practices',
        description: 'A comprehensive guide to building scalable backends with Node.js and TypeScript.',
        image: 'https://example.com/guide-image.jpg',
        category: 'GUIDE',
        status: 'PUBLIC',
      });

    expect(createRes.status).toBe(201);
    const resource = createRes.body.data;

    // 2. Public List
    const listRes = await request(app).get('/api/v1/resources/popular');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.some((r: any) => r.slug === resource.slug)).toBe(true);

    // 3. Public Get
    const getRes = await request(app).get(`/api/v1/resources/popular/${resource.slug}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.title).toBe('Best Node.js Practices');

    // 4. Update
    const updateRes = await request(app)
      .patch(`/api/v1/admin/resources/popular/${resource.slug}`)
      .set(adminHeaders)
      .send({ title: 'Ultimate Node.js Guide' });
    expect(updateRes.status).toBe(200);

    // 5. Delete
    const delRes = await request(app)
      .delete(`/api/v1/admin/resources/popular/${resource.slug}`)
      .set(adminHeaders);
    expect(delRes.status).toBe(204);
  });

  it('should handle the "Product Updates" lifecycle', async () => {
    /**
     * JOURNEY:
     * 1. Admin creates a product update
     * 2. Public user views updates
     * 3. Admin deletes update
     */
    const createRes = await request(app)
      .post('/api/v1/admin/resources/product-updates')
      .set(adminHeaders)
      .send({
        title: 'v1.2.0 Release',
        description: 'Added e2e testing and improved performance.',
        date: new Date().toISOString(),
        version: '1.2.0',
        status: 'PUBLIC',
      });

    expect(createRes.status).toBe(201);
    const update = createRes.body.data;

    const listRes = await request(app).get('/api/v1/resources/product-updates');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.some((u: any) => u.slug === update.slug)).toBe(true);

    const delRes = await request(app)
      .delete(`/api/v1/admin/resources/product-updates/${update.slug}`)
      .set(adminHeaders);
    expect(delRes.status).toBe(204);
  });
});
