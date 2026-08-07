import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';
import { runTaskRecurrenceCron } from '../../modules/task/taskRecurrence.cron.js';

describe('🔁 Recurring Task Journey', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('creates a recurring task via API, runs the cron, and generates a second task instance', async () => {
    /**
     * JOURNEY:
     * 1. User creates a project
     * 2. User creates a recurring task inside it
     * 3. The recurrence scheduler runs
     * 4. A second task instance is generated for the same recurrence
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-recurring-${Date.now()}`,
    });

    // 1. Project (required so the task lands in the workspace)
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set(headers)
      .send({ name: 'Recurring Task Project', workspaceId: testWorkspace.id });
    expect(projRes.status).toBe(201);
    const project = projRes.body.data;

    // 2. Recurring task via the real API
    const createRes = await request(app)
      .post('/api/v1/tasks')
      .set(headers)
      .send({
        title: 'Daily Standup Notes',
        projectId: project.id,
        workspaceId: testWorkspace.id,
        recurrence: { pattern: 'DAILY', interval: 1 },
      });

    expect(createRes.status).toBe(201);
    const task = createRes.body.data;
    expect(task.id).toBeDefined();
    // The create response embeds the recurrence created in the same transaction
    expect(task.recurrence).toMatchObject({ pattern: 'DAILY', interval: 1 });

    // 3. Backdate lastOccurredAt so the recurrence is "due" on the next run.
    //    A freshly created recurrence anchors to now/future due dates (nothing is
    //    due yet), so this scaffolding simulates an interval that has elapsed.
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const recurrence = await prisma.taskRecurrence.update({
      where: { id: task.recurrence.id },
      data:  { lastOccurredAt: past },
    });

    // 4. Run the scheduler (the same runner the 01:00 daily cron invokes)
    await runTaskRecurrenceCron();

    // 5. Assert a second task instance was generated for this recurrence
    const instances = await prisma.task.findMany({
      where:   { recurrenceId: recurrence.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(instances).toHaveLength(1);

    const generated = instances[0];
    expect(generated.title).toBe('Daily Standup Notes');
    expect(generated.status).toBe('TODO');
    expect(generated.workspaceId).toBe(testWorkspace.id);
    expect(generated.projectId).toBe(project.id);
    expect(generated.recurrenceId).toBe(recurrence.id);

    // The generated instance is due one day after the backdated anchor
    const expectedDue = new Date(past);
    expectedDue.setDate(expectedDue.getDate() + 1);
    expect(generated.recurrenceDueDate?.getTime()).toBe(expectedDue.getTime());
    expect(generated.dueDate?.getTime()).toBe(expectedDue.getTime());

    // Workspace now holds the anchor task + the generated instance
    const workspaceTaskCount = await prisma.task.count({
      where: { workspaceId: testWorkspace.id },
    });
    expect(workspaceTaskCount).toBe(2);

    // The recurrence cursor advanced to the generated due date
    const advanced = await prisma.taskRecurrence.findUnique({
      where: { id: recurrence.id },
    });
    expect(advanced?.lastOccurredAt?.getTime()).toBe(expectedDue.getTime());
  });

  it('reflects recurrence upsert and stop in the update API response', async () => {
    /**
     * JOURNEY:
     * 1. User creates a plain task
     * 2. User attaches a recurrence via PUT — the response embeds it
     * 3. User stops the recurrence via PUT with recurrence: null — the response
     *    embeds null and no recurrence row remains
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-recurring-update-${Date.now()}`,
    });

    const projRes = await request(app)
      .post('/api/v1/projects')
      .set(headers)
      .send({ name: 'Update Recurrence Project', workspaceId: testWorkspace.id });
    expect(projRes.status).toBe(201);
    const project = projRes.body.data;

    const createRes = await request(app)
      .post('/api/v1/tasks')
      .set(headers)
      .send({
        title: 'Standup Notes',
        projectId: project.id,
        workspaceId: testWorkspace.id,
      });
    expect(createRes.status).toBe(201);
    const task = createRes.body.data;
    expect(task.recurrence).toBeNull();

    // Attach a recurrence — the PUT response must reflect it
    const upsertRes = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(headers)
      .send({ recurrence: { pattern: 'WEEKLY', interval: 2 } });
    expect(upsertRes.status).toBe(200);
    expect(upsertRes.body.data.recurrence).toMatchObject({ pattern: 'WEEKLY', interval: 2 });

    // Stop the recurrence — the PUT response must reflect null
    const stopRes = await request(app)
      .put(`/api/v1/tasks/${task.id}`)
      .set(headers)
      .send({ recurrence: null });
    expect(stopRes.status).toBe(200);
    expect(stopRes.body.data.recurrence).toBeNull();

    const remaining = await prisma.taskRecurrence.findUnique({
      where: { taskId: task.id },
    });
    expect(remaining).toBeNull();
  });
});
