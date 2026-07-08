import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, createAdminUser, createUser } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

describe('👑 Admin Dashboard Journeys', () => {
  let adminUser: any;
  let regularUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    adminUser = await createAdminUser();
    regularUser = await createUser();
    const setup = await createWorkspaceWithOwner();
    testWorkspace = setup.workspace;
  });

  it('should complete the "Admin Stats" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves platform statistics
     * 2. System returns aggregated stats
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-stats-${Date.now()}`,
    });

    const statsRes = await request(app)
      .get('/api/v1/admin/stats')
      .set(adminHeaders);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.success).toBe(true);
    expect(statsRes.body.data).toBeDefined();
  });

  it('should complete the "Admin Workspaces List" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves paginated list of workspaces
     * 2. System returns workspaces with pagination
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-workspaces-${Date.now()}`,
    });

    const workspacesRes = await request(app)
      .get('/api/v1/admin/workspaces')
      .set(adminHeaders)
      .query({ page: 1, limit: 10 });

    expect(workspacesRes.status).toBe(200);
    expect(workspacesRes.body.success).toBe(true);
    expect(Array.isArray(workspacesRes.body.data)).toBe(true);
    expect(workspacesRes.body.pagination).toBeDefined();
  });

  it('should complete the "Admin Workspace Detail" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves details of a specific workspace by slug
     * 2. System returns workspace details
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-ws-detail-${Date.now()}`,
    });

    const detailRes = await request(app)
      .get(`/api/v1/admin/workspaces/${testWorkspace.slug}`)
      .set(adminHeaders);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data.slug).toBe(testWorkspace.slug);
  });

  it('should complete the "Admin Users List" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves paginated list of users
     * 2. System returns users with pagination
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-users-${Date.now()}`,
    });

    const usersRes = await request(app)
      .get('/api/v1/admin/users')
      .set(adminHeaders)
      .query({ page: 1, limit: 10 });

    expect(usersRes.status).toBe(200);
    expect(usersRes.body.success).toBe(true);
    expect(Array.isArray(usersRes.body.data)).toBe(true);
    expect(usersRes.body.pagination).toBeDefined();
  });

  it('should complete the "Admin User Detail" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves details of a specific user
     * 2. System returns user details
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-user-detail-${Date.now()}`,
    });

    const userDetailRes = await request(app)
      .get(`/api/v1/admin/users/${regularUser.id}`)
      .set(adminHeaders);

    expect(userDetailRes.status).toBe(200);
    expect(userDetailRes.body.success).toBe(true);
    expect(userDetailRes.body.data.id).toBe(regularUser.id);
  });

  it('should complete the "Admin Projects List" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves paginated list of projects
     * 2. System returns projects with pagination
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-projects-${Date.now()}`,
    });

    const projectsRes = await request(app)
      .get('/api/v1/admin/projects')
      .set(adminHeaders)
      .query({ page: 1, limit: 10 });

    expect(projectsRes.status).toBe(200);
    expect(projectsRes.body.success).toBe(true);
    expect(Array.isArray(projectsRes.body.data)).toBe(true);
    expect(projectsRes.body.pagination).toBeDefined();
  });

  it('should complete the "Admin Billing List" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves paginated list of billing records
     * 2. System returns billing records with pagination
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-billing-${Date.now()}`,
    });

    const billingRes = await request(app)
      .get('/api/v1/admin/billing')
      .set(adminHeaders)
      .query({ page: 1, limit: 10 });

    expect(billingRes.status).toBe(200);
    expect(billingRes.body.success).toBe(true);
    expect(Array.isArray(billingRes.body.data)).toBe(true);
    expect(billingRes.body.pagination).toBeDefined();
  });

  it('should complete the "Admin Activity List" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin retrieves paginated list of activity logs
     * 2. System returns activity logs with pagination
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-activity-${Date.now()}`,
    });

    const activityRes = await request(app)
      .get('/api/v1/admin/activity')
      .set(adminHeaders)
      .query({ page: 1, limit: 10 });

    expect(activityRes.status).toBe(200);
    expect(activityRes.body.success).toBe(true);
    expect(Array.isArray(activityRes.body.data)).toBe(true);
    expect(activityRes.body.pagination).toBeDefined();
  });

  it('should complete the "Update Workspace Limits" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin updates workspace limits (plan, maxMembers, maxStorage)
     * 2. System confirms update
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-limits-${Date.now()}`,
    });

    const updateRes = await request(app)
      .patch(`/api/v1/admin/workspaces/${testWorkspace.slug}/limits`)
      .set(adminHeaders)
      .send({
        plan: 'BUSINESS',
        maxMembers: 50,
        maxStorage: 10000,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.message).toContain('updated successfully');
  });

  it('should complete the "Ban User" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin bans a user with a reason
     * 2. System confirms ban
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-ban-${Date.now()}`,
    });

    const banRes = await request(app)
      .patch(`/api/v1/admin/users/${regularUser.id}/ban`)
      .set(adminHeaders)
      .send({
        reason: 'Violation of terms of service',
      });

    expect(banRes.status).toBe(200);
    expect(banRes.body.success).toBe(true);
    expect(banRes.body.message).toContain('banned successfully');
  });

  it('should complete the "Unban User" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin unbans a previously banned user
     * 2. System confirms unban
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-unban-${Date.now()}`,
    });

    // First ban the user
    await request(app)
      .patch(`/api/v1/admin/users/${regularUser.id}/ban`)
      .set(adminHeaders)
      .send({ reason: 'Test ban' });

    // Then unban
    const unbanRes = await request(app)
      .patch(`/api/v1/admin/users/${regularUser.id}/unban`)
      .set(adminHeaders);

    expect(unbanRes.status).toBe(200);
    expect(unbanRes.body.success).toBe(true);
    expect(unbanRes.body.message).toContain('unbanned successfully');
  });

  it('should complete the "Delete Workspace" journey (soft delete)', async () => {
    /**
     * JOURNEY:
     * 1. Admin soft deletes a workspace
     * 2. System confirms suspension
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-delete-${Date.now()}`,
    });

    const deleteRes = await request(app)
      .post(`/api/v1/admin/workspaces/${testWorkspace.slug}`)
      .set(adminHeaders)
      .send({
        reason: 'Policy violation',
        hardDelete: false,
      });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.message).toContain('suspended');
  });

  it('should complete the "Delete Workspace" journey (hard delete)', async () => {
    /**
     * JOURNEY:
     * 1. Admin hard deletes a workspace
     * 2. System confirms permanent deletion
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-hard-delete-${Date.now()}`,
    });

    const setup = await createWorkspaceWithOwner();
    const workspaceToDelete = setup.workspace;

    const deleteRes = await request(app)
      .post(`/api/v1/admin/workspaces/${workspaceToDelete.slug}`)
      .set(adminHeaders)
      .send({
        reason: 'Severe policy violation',
        hardDelete: true,
      });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.message).toContain('permanently deleted');
  });

  it('should complete the "Restore Workspace" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin restores a previously deleted workspace
     * 2. System confirms restoration
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-restore-${Date.now()}`,
    });

    // First soft delete the workspace
    await request(app)
      .post(`/api/v1/admin/workspaces/${testWorkspace.slug}`)
      .set(adminHeaders)
      .send({
        reason: 'Test suspension',
        hardDelete: false,
      });

    // Then restore
    const restoreRes = await request(app)
      .patch(`/api/v1/admin/workspaces/${testWorkspace.slug}/restore`)
      .set(adminHeaders);

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.success).toBe(true);
    expect(restoreRes.body.message).toContain('restored successfully');
  });

  it('should reject non-admin access to admin endpoints', async () => {
    /**
     * JOURNEY:
     * 1. Regular user attempts to access admin endpoints
     * 2. System rejects with 403
     */
    const regularHeaders = await authWithCsrfHeaders(regularUser, {
      sessionId: `session-admin-denied-${Date.now()}`,
    });

    const statsRes = await request(app)
      .get('/api/v1/admin/stats')
      .set(regularHeaders);

    expect(statsRes.status).toBe(403);
  });

  it('should handle pagination parameters correctly', async () => {
    /**
     * JOURNEY:
     * 1. Admin requests workspaces with custom pagination
     * 2. System returns correct page size
     */
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-pagination-${Date.now()}`,
    });

    const res = await request(app)
      .get('/api/v1/admin/workspaces')
      .set(adminHeaders)
      .query({ page: 1, limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });
});
