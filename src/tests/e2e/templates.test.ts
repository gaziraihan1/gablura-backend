import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createAdminUser, createUser } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

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
