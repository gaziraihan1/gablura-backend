import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'meeting-test-user-id',
      email: 'meeting-test@example.com',
      role: 'ADMIN',
      name: 'Meeting Tester',
      sessionId: 'meeting-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

vi.mock('../../../modules/billing/index.js', () => ({
  requireMeetingSlot: (req: any, res: any, next: any) => next(),
}));

// --- Contract Schemas ---

const MeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  link: z.string().nullable(),
  location: z.string().nullable(),
  visibility: z.string(),
  status: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceId: z.string(),
  createdById: z.string(),
});

// --- Tests ---

describe('Meeting API Contract Tests', () => {
  let app: any;
  const testUserId = 'meeting-test-user-id';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ensureUserExists = async () => {
    await prisma.user.upsert({
      where: { email: 'meeting-test@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'meeting-test@example.com',
        password: 'password123',
        name: 'Meeting Tester',
        emailVerified: new Date(),
      },
    });
  };

  describe('Read Operations', () => {
    let testWorkspaceId: string;
    let testMeetingId: string;

    beforeEach(async () => {
      await ensureUserExists();

      const workspace = await prisma.workspace.create({
        data: {
          name: 'Meeting Test Workspace',
          slug: `meeting-ws-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: { userId: testUserId, role: 'OWNER' },
          },
        },
      });
      testWorkspaceId = workspace.id;

      const meeting = await prisma.meeting.create({
        data: {
          title: 'Contract Test Meeting',
          startTime: new Date(Date.now() + 3600000),
          endTime: new Date(Date.now() + 7200000),
          workspaceId: testWorkspaceId,
          createdById: testUserId,
        },
      });
      testMeetingId = meeting.id;
    });

    it('GET /:workspaceId/meetings should match the contract', async () => {
      const response = await request(app).get(`/api/v1/meetings/${testWorkspaceId}/meetings`);
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      
      const data = response.body.data;
      expect(data).toHaveProperty('meetings');
      expect(Array.isArray(data.meetings)).toBe(true);
      if (data.meetings.length > 0) {
        validateContract(MeetingSchema, data.meetings[0]);
      }
    });

    it('GET /:workspaceId/meetings/:meetingId should match the contract', async () => {
      const response = await request(app).get(`/api/v1/meetings/${testWorkspaceId}/meetings/${testMeetingId}`);
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(MeetingSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /:workspaceId/meetings should return a valid meeting on creation', async () => {
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Meeting Creation Workspace',
          slug: `meeting-create-ws-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: { userId: testUserId, role: 'OWNER' },
          },
        },
      });

      const response = await request(app)
        .post(`/api/v1/meetings/${workspace.id}/meetings`)
        .send({
          title: 'New Contract Meeting',
          visibility: 'PUBLIC',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(MeetingSchema, response.body.data);
    });
  });
});
