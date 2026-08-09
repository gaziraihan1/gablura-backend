import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createAdminUser, createUser } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';
import { prisma } from '../../lib/prisma.js';

describe('📄 Template Request Journeys', () => {
  let adminUser: any;

  beforeEach(async () => {
    adminUser = await createAdminUser();
  });

  it('should complete the "Public Template Request" journey', async () => {
    /**
     * JOURNEY:
     * 1. Anonymous user requests a template via email
     * 2. Verify the email is added to the TemplateList
     * 3. Admin verifies the template list
     * 4. Admin deletes an entry from the list and verifies it's gone
     */
    const testEmail = `template-test-${Date.now()}@example.com`;

    // 1. Anonymous request
    const requestRes = await request(app)
      .post('/api/v1/templates')
      .send({ email: testEmail });

    expect(requestRes.status).toBe(200);
    expect(requestRes.body.success).toBe(true);
    expect(requestRes.body.message).toContain(testEmail);

    // 2. Admin verifies the list
    const adminHeaders = await authWithCsrfHeaders(adminUser);
    const listRes = await request(app)
      .get('/api/v1/templates')
      .set(adminHeaders);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.some((item: any) => item.email === testEmail)).toBe(true);

    // 3. Admin deletes the entry
    const deleteRes = await request(app)
      .delete(`/api/v1/templates/${encodeURIComponent(testEmail)}`)
      .set(adminHeaders);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // 4. Verify it's gone
    const finalVerifyRes = await request(app)
      .get('/api/v1/templates')
      .set(adminHeaders);

    expect(finalVerifyRes.body.data.some((item: any) => item.email === testEmail)).toBe(false);
  });

  it('should prevent duplicate template requests', async () => {
    const testEmail = `duplicate-test-${Date.now()}@example.com`;

    // First request
    await request(app)
      .post('/api/v1/templates')
      .send({ email: testEmail });

    // Duplicate request
    const dupRes = await request(app)
      .post('/api/v1/templates')
      .send({ email: testEmail });

    expect(dupRes.status).toBe(400);
    expect(dupRes.body.success).toBe(false);
  });

  it('should prevent non-admins from accessing template list', async () => {
    const normalUser = await createUser();
    const userHeaders = await authWithCsrfHeaders(normalUser);

    const res = await request(app)
      .get('/api/v1/templates')
      .set(userHeaders);

    expect(res.status).toBe(403);
  });
});

describe('📄 Template delete route disambiguation', () => {
  it('lets a non-admin template author delete their own template via DELETE /:slug', async () => {
    const author = await createUser();
    const authorHeaders = await authWithCsrfHeaders(author);
    const slug = `author-del-${Date.now()}`;

    await prisma.projectTemplate.create({
      data: {
        slug,
        title: 'Author Owned',
        description: '',
        category: 'operations',
        complexity: 'starter',
        tier: 'FREE',
        status: 'available',
        visibility: 'PRIVATE',
        authorId: author.id,
        content: {} as object,
      },
    });

    const res = await request(app)
      .delete(`/api/v1/templates/${slug}`)
      .set(authorHeaders);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('blocks non-admins from the waitlist DELETE /:email path', async () => {
    const user = await createUser();
    const userHeaders = await authWithCsrfHeaders(user);

    const res = await request(app)
      .delete(`/api/v1/templates/test-${Date.now()}@example.com`)
      .set(userHeaders);

    expect(res.status).toBe(403);
  });
});

describe('⭐ Template rating journeys', () => {
  it('lets users rate a public template once each and aggregates the average', async () => {
    const slug = `rate-e2e-${Date.now()}`;
    await prisma.projectTemplate.create({
      data: {
        slug,
        title: 'Rate Me',
        description: '',
        category: 'operations',
        complexity: 'starter',
        tier: 'FREE',
        status: 'available',
        visibility: 'PUBLIC',
        content: {} as object,
      },
    });

    const userA = await createUser();
    const userB = await createUser();
    const headersA = await authWithCsrfHeaders(userA);
    const headersB = await authWithCsrfHeaders(userB);

    const first = await request(app)
      .post(`/api/v1/templates/${slug}/rate`)
      .set(headersA)
      .send({ stars: 5 });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ average: 5, count: 1 });

    const second = await request(app)
      .post(`/api/v1/templates/${slug}/rate`)
      .set(headersB)
      .send({ stars: 3 });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ average: 4, count: 2 });

    // Re-rating replaces the user's previous stars (1 + 3 = 4 / 2 = 2)
    const rerate = await request(app)
      .post(`/api/v1/templates/${slug}/rate`)
      .set(headersA)
      .send({ stars: 1 });
    expect(rerate.status).toBe(200);
    expect(rerate.body.data).toMatchObject({ average: 2, count: 2 });
  });

  it('rejects out-of-range stars', async () => {
    const user = await createUser();
    const headers = await authWithCsrfHeaders(user);
    const res = await request(app)
      .post('/api/v1/templates/engineering-sprint/rate')
      .set(headers)
      .send({ stars: 7 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing templates', async () => {
    const user = await createUser();
    const headers = await authWithCsrfHeaders(user);
    const res = await request(app)
      .post('/api/v1/templates/definitely-not-a-template/rate')
      .set(headers)
      .send({ stars: 4 });
    expect(res.status).toBe(404);
  });
});
