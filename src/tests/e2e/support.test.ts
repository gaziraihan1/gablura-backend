import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { 
  createAdminUser 
} from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

describe('🎧 Support & Contact Journeys', () => {
  let adminUser: any;
  let adminHeaders: any;

  beforeEach(async () => {
    adminUser = await createAdminUser();
    adminHeaders = await authWithCsrfHeaders(adminUser);
  });

  it('should handle the "Contact Support" journey', async () => {
    /**
     * JOURNEY:
     * 1. Public user submits a contact message
     * 2. Admin lists contact messages
     * 3. Admin verifies the message is present
     */

    // 1. Public Submit
    const submitRes = await request(app)
      .post('/api/v1/contact')
      .send({
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'Payment Issue',
        message: 'I was charged twice for my subscription.',
        category: 'BILLING',
      });

    expect(submitRes.status).toBe(201);
    const messageId = submitRes.body.data.id;

    // 2. Admin List
    const listRes = await request(app)
      .get('/api/v1/contact')
      .set(adminHeaders);

    expect(listRes.status).toBe(200);
    
    // 3. Verify
    expect(listRes.body.messages.some((m: any) => m.id === messageId)).toBe(true);
  });
});
