// src/tests/integration/contact/contact.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for:
//   POST /api/v1/contact   — public, rate-limit bypassed in test env
//   GET  /api/v1/contact   — Focura-admin only
//
// Email sending is mocked globally in setup.ts (nodemailer / cloudinary).
// The rate-limit middleware skips in NODE_ENV=test so we never hit 429 here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createUser, createAdminUser } from '../factories/index.js';
import { authHeaders } from '../helpers/auth.js';
import { registerFocuraAdmin } from '../factories/index.js';

const BASE = '/api/v1/contact';

// ─────────────────────────────────────────────────────────────────────────────
// Shared valid payload
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PAYLOAD = {
  name:     'Jane Smith',
  email:    'jane@example.com',
  subject:  'Question about billing plans',
  category: 'BILLING',
  message:  'I would like to know more about the PRO plan pricing and what it includes.',
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/contact
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/contact', () => {
  it('201 — creates a contact message and returns id + createdAt', async () => {
    const res = await request(app).post(BASE).send(VALID_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id:        expect.any(String),
      createdAt: expect.any(String),
    });
    expect(res.body.message).toMatch(/2 business days/i);
  });

  it('201 — persists the message to the database', async () => {
    const res = await request(app).post(BASE).send(VALID_PAYLOAD);
    expect(res.status).toBe(201);

    const db = await prisma.contactMessage.findUnique({
      where: { id: res.body.data.id },
    });

    expect(db).not.toBeNull();
    expect(db?.name).toBe(VALID_PAYLOAD.name);
    expect(db?.email).toBe(VALID_PAYLOAD.email);
    expect(db?.subject).toBe(VALID_PAYLOAD.subject);
    expect(db?.category).toBe(VALID_PAYLOAD.category);
    expect(db?.status).toBe('UNREAD');
  });

  it('201 — email is stored lowercased (schema trim + toLowerCase)', async () => {
    const res = await request(app)
      .post(BASE)
      .send({ ...VALID_PAYLOAD, email: '  Jane@EXAMPLE.COM  ' });

    expect(res.status).toBe(201);

    const db = await prisma.contactMessage.findUnique({ where: { id: res.body.data.id } });
    expect(db?.email).toBe('jane@example.com');
  });

  it('201 — accepts all valid category values', async () => {
    const categories = ['GENERAL', 'BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'PARTNERSHIP', 'SECURITY', 'OTHER'];

    for (const category of categories) {
      const res = await request(app)
        .post(BASE)
        .send({ ...VALID_PAYLOAD, category });

      expect(res.status).toBe(201);
    }
  });

  it('201 — no auth token required (public route)', async () => {
    // Explicitly no .set(authHeaders(...))
    const res = await request(app).post(BASE).send(VALID_PAYLOAD);
    expect(res.status).toBe(201);
  });

  // ── Validation errors ────────────────────────────────────────────────────

  it('400 — name shorter than 2 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, name: 'J' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('400 — name longer than 100 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, name: 'A'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('400 — invalid email format', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('400 — subject shorter than 5 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, subject: 'Hi' });
    expect(res.status).toBe(400);
  });

  it('400 — subject longer than 200 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, subject: 'S'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('400 — message shorter than 20 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, message: 'Too short.' });
    expect(res.status).toBe(400);
  });

  it('400 — message longer than 5000 characters', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, message: 'M'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  it('400 — invalid category enum value', async () => {
    const res = await request(app).post(BASE).send({ ...VALID_PAYLOAD, category: 'SPAM' });
    expect(res.status).toBe(400);
  });

  it('400 — missing required fields', async () => {
    const res = await request(app).post(BASE).send({});
    expect(res.status).toBe(400);
  });

  it('400 — missing message field', async () => {
    const { message: _omit, ...rest } = VALID_PAYLOAD;
    const res = await request(app).post(BASE).send(rest);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/contact
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/contact', () => {
  async function seedMessages(count: number) {
    for (let i = 0; i < count; i++) {
      await prisma.contactMessage.create({
        data: {
          name:      `User ${i}`,
          email:     `user${i}@example.com`,
          subject:   `Subject ${i} — testing the contact form`,
          category:  i % 2 === 0 ? 'GENERAL' : 'BILLING',
          message:   `This is message number ${i} with enough content to pass validation.`,
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          status:    i % 3 === 0 ? 'UNREAD' : 'READ',
        },
      });
    }
  }

  it('200 — Focura admin can list messages', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(3);

    const res = await request(app).get(BASE).set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('200 — response includes pagination metadata', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(5);

    const res = await request(app).get(BASE).set(authHeaders(admin));

    expect(res.body.pagination).toMatchObject({
      page:       expect.any(Number),
      limit:      expect.any(Number),
      total:      expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('200 — messages ordered newest first', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(3);

    const res = await request(app).get(BASE).set(authHeaders(admin));

    expect(res.status).toBe(200);
    const dates = res.body.messages.map((m: any) => new Date(m.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });

  it('200 — filters by status query param', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(6);

    const res = await request(app)
      .get(BASE)
      .query({ status: 'UNREAD' })
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.messages.every((m: any) => m.status === 'UNREAD')).toBe(true);
  });

  it('200 — filters by category query param', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(6);

    const res = await request(app)
      .get(BASE)
      .query({ category: 'BILLING' })
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.messages.every((m: any) => m.category === 'BILLING')).toBe(true);
  });

  it('200 — respects page and limit query params', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(5);

    const res = await request(app)
      .get(BASE)
      .query({ page: 1, limit: 2 })
      .set(authHeaders(admin));

    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.limit).toBe(2);
  });

  it('200 — response messages do not include ipAddress or userAgent', async () => {
    const admin = await createAdminUser();
    registerFocuraAdmin(admin.id);
    await seedMessages(1);

    const res = await request(app).get(BASE).set(authHeaders(admin));

    expect(res.status).toBe(200);
    for (const msg of res.body.messages) {
      expect(msg.ipAddress).toBeUndefined();
      expect(msg.userAgent).toBeUndefined();
    }
  });

  it('401 — unauthenticated request is rejected', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it('403 — regular user (non Focura-admin) is rejected', async () => {
    const user = await createUser();
    const res = await request(app).get(BASE).set(authHeaders(user));
    expect(res.status).toBe(403);
  });

  it('403 — ADMIN role user without FOCURA_ADMIN_IDS registration is rejected', async () => {
    // createAdminUser gives DB role ADMIN but doesn't add to FOCURA_ADMIN_IDS
    const admin = await createAdminUser();
    // Deliberately NOT calling registerFocuraAdmin(admin.id)

    // Reset env to remove any stale IDs from other tests
    const prev = process.env.FOCURA_ADMIN_IDS ?? '';
    process.env.FOCURA_ADMIN_IDS = '';

    const res = await request(app).get(BASE).set(authHeaders(admin));
    expect(res.status).toBe(403);

    process.env.FOCURA_ADMIN_IDS = prev;
  });
});
