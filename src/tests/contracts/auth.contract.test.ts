import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';
import { buildExchangeProof } from '../helpers/auth.js';
import { randomUUID } from 'crypto';

describe('Auth API Contract Tests', () => {
  let app: any;
  const testUserId = 'cmtbcsscn0000h0kz0uml7651'; // Valid CUID
  const testEmail = 'auth-test@example.com';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const AuthTokenSchema = z.object({
    success: z.literal(true),
    accessToken: z.string(),
    refreshToken: z.string(),
    sseToken: z.string(),
    accessTokenExpiry: z.number(),
    refreshTokenExpiry: z.number(),
  });

  async function setupTestUser() {
    await prisma.user.upsert({
      where: { email: testEmail },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: testEmail,
        password: 'password123',
        name: 'Auth Tester',
        emailVerified: new Date(),
      },
    });
  }

  describe('Exchange', () => {
    it('POST /auth/exchange should return tokens on valid proof', async () => {
      await setupTestUser();

      const sessionId = randomUUID();
      const timestamp = Date.now();
      const signature = buildExchangeProof({
        userId: testUserId,
        email: testEmail,
        role: 'USER',
        sessionId,
        timestamp,
      });

      const response = await request(app)
        .post('/api/v1/auth/exchange')
        .send({
          userId: testUserId,
          email: testEmail,
          role: 'USER',
          sessionId,
          timestamp,
          signature,
        });

      expect(response.status).toBe(200);
      validateContract(AuthTokenSchema, response.body);
    });

    it('POST /auth/exchange should return 401 on invalid signature', async () => {
      await setupTestUser();
      const response = await request(app)
        .post('/api/v1/auth/exchange')
        .send({
          userId: testUserId,
          email: testEmail,
          role: 'USER',
          sessionId: randomUUID(),
          timestamp: Date.now(),
          signature: 'a'.repeat(64), // Valid format but wrong signature
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Refresh', () => {
    it('POST /auth/refresh should return new tokens on valid refresh token', async () => {
      await setupTestUser();

      const timestamp = Date.now();
      const sessionId = randomUUID();
      const signature = buildExchangeProof({
        userId: testUserId,
        email: testEmail,
        role: 'USER',
        sessionId,
        timestamp,
      });

      const exchangeRes = await request(app)
        .post('/api/v1/auth/exchange')
        .send({
          userId: testUserId,
          email: testEmail,
          role: 'USER',
          sessionId,
          timestamp,
          signature,
        });

      expect(exchangeRes.status).toBe(200);
      const { refreshToken } = exchangeRes.body;

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      validateContract(AuthTokenSchema, response.body);
    });

    it('POST /auth/refresh should return 401 on invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'eyJ.invalid.token' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Logout', () => {
    it('POST /auth/logout should return success', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({ logoutAll: false });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });
});
