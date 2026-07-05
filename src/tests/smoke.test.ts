import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

/**
 * Smoke Tests
 * 
 * These tests verify the absolute minimum requirements for the application to be
 * considered "up and running". They are designed to be fast and cover critical
 * infrastructure paths (App -> Middleware -> DB).
 */
describe('🚀 Application Smoke Tests', () => {
  
  it('should verify the server is alive and database is connected (/health)', async () => {
    const res = await request(app).get('/health');
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body.database).toMatch(/connected|OK/);
  });

  it('should verify public routes are accessible (/api/v1/auth/logout)', async () => {
    // Logout is a public route that shouldn't require a token to return a response
    const res = await request(app).post('/api/v1/auth/logout').send({});
    
    // We expect 200 because the implementation of /logout is best-effort and always returns success
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should verify protected routes are secured (401 Unauthorized)', async () => {
    // Any route using 'authenticate' middleware without a token should return 401
    const res = await request(app).get('/api/v1/workspaces');
    
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('code');
  });

  it('should verify the 404 handler is working for unknown routes', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist-smoke-test');
    
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
  });

});
