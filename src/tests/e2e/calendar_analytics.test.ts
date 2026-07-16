import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, cleanAllTestData } from '../factories/index.js';
import { authWithCsrfHeaders, authHeaders } from '../helpers/auth.js';

describe('📆 Calendar E2E', () => {
  let user: any;
  let headers: any;

  beforeEach(async () => {
    await cleanAllTestData();
    const setup = await createWorkspaceWithOwner();
    user = setup.user;
    headers = await authWithCsrfHeaders(user);
  });

  it('should complete the "Calendar Events" lifecycle', async () => {
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 86400000).toISOString();

    // 1. Get system events
    const eventsRes = await request(app)
      .get(`/api/v1/calendar/system-events?startDate=${startDate}&endDate=${endDate}`)
      .set(authHeaders(user));

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.data).toBeInstanceOf(Array);

    // 2. Log energy level
    const energyRes = await request(app)
      .post('/api/v1/calendar/energy')
      .set(headers)
      .send({
        date: new Date().toISOString(),
        energyLevel: 8,
        note: 'Feeling productive',
      });

    expect(energyRes.status).toBe(201);

    // 3. Get energy history
    const historyRes = await request(app)
      .get(`/api/v1/calendar/energy/history?startDate=${startDate}&endDate=${endDate}`)
      .set(authHeaders(user));

    expect(historyRes.status).toBe(200);
  });

  it('should complete the "Capacity Planning" lifecycle', async () => {
    // 1. Get current capacity
    const capacityRes = await request(app)
      .get('/api/v1/calendar/capacity')
      .set(authHeaders(user));

    expect(capacityRes.status).toBe(200);

    // 2. Update capacity
    const updateRes = await request(app)
      .put('/api/v1/calendar/capacity')
      .set(headers)
      .send({
        weeklyHours: 40,
        dailyCapacityHours: 8,
        deepWorkHours: 4,
      });

    expect(updateRes.status).toBe(200);

    // 3. Update schedule
    const scheduleRes = await request(app)
      .put('/api/v1/calendar/schedule')
      .set(headers)
      .send({
        workDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        workStartHour: 9,
        workEndHour: 17,
      });

    expect(scheduleRes.status).toBe(200);
  });
});
