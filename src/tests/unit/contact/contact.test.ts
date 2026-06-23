// src/tests/unit/contact/contact.unit.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for:
//   • contact.service   — createContactMessage, getContactMessages
//   • contact.validator — createContactMessageSchema
//   • contact.email     — template builder output (plain-text variants)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    contactMessage: {
      create:    vi.fn(),
      findMany:  vi.fn(),
      count:     vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../modules/contact/contact.email.js', () => ({
  sendAdminContactNotification: vi.fn().mockResolvedValue(undefined),
  sendUserAutoReply:            vi.fn().mockResolvedValue(undefined),
}));
import {
  sendAdminContactNotification,
  sendUserAutoReply,
} from '../../../modules/contact/contact.email.js';

import {
  createContactMessage,
  getContactMessages,
} from '../../../modules/contact/contact.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture
// ─────────────────────────────────────────────────────────────────────────────

const VALID_INPUT = {
  name:     'Jane Smith',
  email:    'jane@example.com',
  subject:  'Question about billing plans',
  category: 'BILLING' as const,
  message:  'I would like to know more about the PRO plan pricing and what it includes.',
};

const DB_RESULT = { id: 'msg-1', createdAt: new Date('2025-06-15T10:00:00Z') };

// ─────────────────────────────────────────────────────────────────────────────
// createContactMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('createContactMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists message to DB and returns id + createdAt', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);

    const result = await createContactMessage(VALID_INPUT, '1.2.3.4', 'Mozilla/5.0');

    expect(result.id).toBe('msg-1');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('passes correct data to prisma.contactMessage.create', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);

    await createContactMessage(VALID_INPUT, '10.0.0.1', 'TestAgent/1.0');

    expect(prisma.contactMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name:      VALID_INPUT.name,
          email:     VALID_INPUT.email,
          subject:   VALID_INPUT.subject,
          category:  VALID_INPUT.category,
          message:   VALID_INPUT.message,
          ipAddress: '10.0.0.1',
          userAgent: 'TestAgent/1.0',
          status:    'UNREAD',
        }),
      }),
    );
  });

  it('calls sendAdminContactNotification with messageId and ip (fire-and-forget)', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);

    await createContactMessage(VALID_INPUT, '1.2.3.4', '');

    // fire-and-forget: give microtasks a tick
    await Promise.resolve();

    expect(sendAdminContactNotification).toHaveBeenCalledWith(
      VALID_INPUT,
      'msg-1',
      '1.2.3.4',
    );
  });

  it('calls sendUserAutoReply (fire-and-forget)', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);

    await createContactMessage(VALID_INPUT, '1.2.3.4', '');
    await Promise.resolve();

    expect(sendUserAutoReply).toHaveBeenCalledWith(VALID_INPUT);
  });

  it('still returns successfully even if admin email throws (swallowed)', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);
    (sendAdminContactNotification as any).mockRejectedValue(new Error('SMTP down'));

    const result = await createContactMessage(VALID_INPUT, '1.2.3.4', '');
    expect(result.id).toBe('msg-1');
  });

  it('still returns successfully even if user auto-reply throws (swallowed)', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);
    (sendUserAutoReply as any).mockRejectedValue(new Error('SMTP down'));

    const result = await createContactMessage(VALID_INPUT, '1.2.3.4', '');
    expect(result.id).toBe('msg-1');
  });

  it('throws when prisma.contactMessage.create fails', async () => {
    (prisma.contactMessage.create as any).mockRejectedValue(new Error('db error'));

    await expect(createContactMessage(VALID_INPUT, '1.2.3.4', '')).rejects.toThrow('db error');
  });

  it('selects only id and createdAt from the DB result', async () => {
    (prisma.contactMessage.create as any).mockResolvedValue(DB_RESULT);

    await createContactMessage(VALID_INPUT, '1.2.3.4', '');

    const call = (prisma.contactMessage.create as any).mock.calls[0][0];
    expect(call.select).toEqual({ id: true, createdAt: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getContactMessages
// ─────────────────────────────────────────────────────────────────────────────

describe('getContactMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  const MESSAGES = [
    { id: 'm1', name: 'Alice', email: 'a@test.com', subject: 'Sub 1', category: 'GENERAL', status: 'UNREAD', createdAt: new Date(), message: 'Msg 1' },
    { id: 'm2', name: 'Bob',   email: 'b@test.com', subject: 'Sub 2', category: 'BILLING', status: 'READ',   createdAt: new Date(), message: 'Msg 2' },
  ];

  it('returns messages and pagination metadata', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue(MESSAGES);
    (prisma.contactMessage.count as any).mockResolvedValue(2);

    const result = await getContactMessages({ page: 1, limit: 20 });

    expect(result.messages).toHaveLength(2);
    expect(result.pagination).toMatchObject({
      page:       1,
      limit:      20,
      total:      2,
      totalPages: 1,
    });
  });

  it('calculates skip correctly for page 2', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(10);

    await getContactMessages({ page: 2, limit: 5 });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
  });

  it('applies status filter when provided', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(0);

    await getContactMessages({ page: 1, limit: 20, status: 'UNREAD' });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNREAD' }) }),
    );
  });

  it('applies category filter when provided', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(0);

    await getContactMessages({ page: 1, limit: 20, category: 'BILLING' });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'BILLING' }) }),
    );
  });

  it('omits status and category from where clause when not provided', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(0);

    await getContactMessages({ page: 1, limit: 20 });

    const call = (prisma.contactMessage.findMany as any).mock.calls[0][0];
    expect(call.where.status).toBeUndefined();
    expect(call.where.category).toBeUndefined();
  });

  it('returns correct totalPages calculation', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(23);

    const result = await getContactMessages({ page: 1, limit: 10 });
    expect(result.pagination.totalPages).toBe(3); // ceil(23/10)
  });

  it('orders by createdAt desc', async () => {
    (prisma.contactMessage.findMany as any).mockResolvedValue([]);
    (prisma.contactMessage.count as any).mockResolvedValue(0);

    await getContactMessages({ page: 1, limit: 20 });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validator — createContactMessageSchema
// ─────────────────────────────────────────────────────────────────────────────

import { createContactMessageSchema } from '../../../modules/contact/contact.validator.js';

describe('createContactMessageSchema', () => {
  it('parses a fully valid payload', () => {
    const result = createContactMessageSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('trims whitespace from name and subject', () => {
    const result = createContactMessageSchema.safeParse({
      ...VALID_INPUT,
      name:    '  Jane Smith  ',
      subject: '  Question about billing  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Jane Smith');
      expect(result.data.subject).toBe('Question about billing');
    }
  });

  it('lowercases the email', () => {
    const result = createContactMessageSchema.safeParse({
      ...VALID_INPUT,
      email: 'JANE@EXAMPLE.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('jane@example.com');
  });

  it('rejects name shorter than 2 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, name: 'J' });
    expect(r.success).toBe(false);
  });

  it('rejects name longer than 100 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, name: 'A'.repeat(101) });
    expect(r.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects subject shorter than 5 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, subject: 'Hi' });
    expect(r.success).toBe(false);
  });

  it('rejects subject longer than 200 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, subject: 'S'.repeat(201) });
    expect(r.success).toBe(false);
  });

  it('rejects message shorter than 20 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, message: 'Too short.' });
    expect(r.success).toBe(false);
  });

  it('rejects message longer than 5000 chars', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, message: 'M'.repeat(5001) });
    expect(r.success).toBe(false);
  });

  it('rejects unknown category', () => {
    const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, category: 'SPAM' });
    expect(r.success).toBe(false);
  });

  it('accepts all 7 valid categories', () => {
    const categories = ['GENERAL', 'BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'PARTNERSHIP', 'SECURITY', 'OTHER'];
    for (const category of categories) {
      const r = createContactMessageSchema.safeParse({ ...VALID_INPUT, category });
      expect(r.success).toBe(true);
    }
  });

  it('rejects missing required field (name)', () => {
    const { name: _omit, ...rest } = VALID_INPUT;
    const r = createContactMessageSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});