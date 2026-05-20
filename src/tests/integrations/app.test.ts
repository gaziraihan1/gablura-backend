// src/tests/integration/app/app.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the Express app layer itself:
//   • /health endpoint
//   • 404 for unknown routes
//   • CORS headers
//   • Error handler shape (success: false, message)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../app.js';

describe('GET /health', () => {
  it('200 — returns status OK', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.timestamp).toBeDefined();
  });

  it('200 — does not require auth token', async () => {
    // No .set(authHeaders) — must be public
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('404 — unknown routes', () => {
  it('404 — GET to undefined route', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
    expect(res.body.path).toBeDefined();
    expect(res.body.method).toBe('GET');
  });

  it('404 — POST to undefined route', async () => {
    const res = await request(app).post('/api/v1/totally-fake-endpoint').send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('Error response shape', () => {
  it('401 responses include code field', async () => {
    // Any protected route without auth
    const res = await request(app).get('/api/v1/workspaces');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('message');
    expect(res.body.success).toBe(false);
  });
});

describe('CORS headers', () => {
  it('includes CORS headers for allowed origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('OPTIONS preflight returns 204 / CORS headers', async () => {
    const res = await request(app)
      .options('/api/v1/workspaces')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });
});