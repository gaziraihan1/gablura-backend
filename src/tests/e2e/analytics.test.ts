import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, createUser } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';
import { prisma } from '../../lib/prisma.js';

describe('📈 Analytics & Usage Journeys', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;

    // Upgrade workspace to PRO to enable Analytics and Usage tracking
    await prisma.workspace.update({
      where: { id: testWorkspace.id },
      data: { plan: 'PRO' },
    });
  });

  it('should complete the "Workspace Analytics Overview" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates some tasks and focus sessions to generate data
     * 2. User retrieves workspace analytics overview
     * 3. User verifies that the analytics data contains expected keys
     */
    const headers = await authWithCsrfHeaders(testUser);

    // 1. Generate data
    const taskRes = await request(app)
      .post('/api/v1/tasks')
      .set(headers)
      .send({
        title: 'Analytics Task',
        workspaceId: testWorkspace.id,
      });
    const task = taskRes.body.data;

    // Create a focus session
    await request(app)
      .post('/api/v1/focus-sessions/start')
      .set(headers)
      .send({ taskId: task.id });

    // 2. Get Analytics Overview
    const analyticsRes = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/overview`)
      .set(headers);

    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.success).toBe(true);
    expect(analyticsRes.body.data).toHaveProperty('kpis');
    expect(analyticsRes.body.data).toHaveProperty('taskStatus');
    expect(analyticsRes.body.data).toHaveProperty('projectStatus');
  });

  it('should complete the "Task Trends & Health" journey', async () => {
    /**
     * JOURNEY:
     * 1. User retrieves task trends
     * 2. User retrieves project health
     * 3. User verifies responses are successful and formatted correctly
     */
    const headers = await authWithCsrfHeaders(testUser);

    const trendsRes = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/tasks/trends`)
      .set(headers);

    expect(trendsRes.status).toBe(200);
    expect(trendsRes.body.success).toBe(true);
    expect(trendsRes.body.data).toHaveProperty('completionTrend');
    expect(trendsRes.body.data).toHaveProperty('overdueTrend');

    const healthRes = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/projects/health`)
      .set(headers);

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.success).toBe(true);
    expect(Array.isArray(healthRes.body.data)).toBe(true);
  });

  it('should complete the "Workspace Usage Tracking" journey', async () => {
    /**
     * JOURNEY:
     * 1. User checks the current workspace usage
     * 2. User verifies usage data (storage, members, projects) is returned
     */
    const headers = await authWithCsrfHeaders(testUser);

    const usageRes = await request(app)
      .get(`/api/v1/workspace-usage/${testWorkspace.id}/usage`)
      .set(headers);

    expect(usageRes.status).toBe(200);
    expect(usageRes.body.success).toBe(true);
    
    const data = usageRes.body.data;
    expect(data.planLimits).toHaveProperty('storageUsedMB');
    expect(data.planLimits).toHaveProperty('storageLimitMB');
    expect(data.planLimits).toHaveProperty('memberCount');
    expect(data.planLimits).toHaveProperty('projectCount');
  });

  it('should prevent unauthorized users from accessing analytics', async () => {
    /**
     * JOURNEY:
     * 1. Create a second user who is not a member of the workspace
     * 2. User attempts to access analytics of that workspace
     * 3. Verify access is forbidden
     */
    const intruder = await createUser();
    const intruderHeaders = await authWithCsrfHeaders(intruder);

    const res = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/overview`)
      .set(intruderHeaders);

    expect(res.status).toBe(403);
  });
});
