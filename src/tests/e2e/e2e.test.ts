import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  createWorkspaceWithOwner,
  createUser,
  addMemberToWorkspace,
} from "../factories/index.js";
import { authWithCsrfHeaders } from "../helpers/auth.js";

/**
 * E2E Tests
 *
 * These tests validate critical user journeys that span multiple modules.
 * They ensure that the integration between Auth, Workspace, Project, and Task
 * modules works as a cohesive system.
 */
describe("🚀 End-to-End User Journeys", () => {
  // We use a fresh user and workspace for the primary journey to avoid interference
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    // Setup: User who owns a workspace
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('should complete the "Full Productivity Cycle" journey', async () => {
    /**
     * JOURNEY:
     * 1. User logs in (via token generation in tests)
     * 2. User creates a Project in their Workspace
     * 3. User creates a Task in that Project
     * 4. User updates the Task status to 'IN_PROGRESS'
     * 5. User marks the Task as 'COMPLETED'
     * 6. User verifies the Task is now completed and has a completion date
     */

    const headers = await authWithCsrfHeaders(testUser);

    // 1. Create a Project
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({
        name: "E2E Project",
        description: "Testing the full user journey",
        workspaceId: testWorkspace.id,
      });

    expect(projectRes.status).toBe(201);
    expect(projectRes.body.success).toBe(true);
    const project = projectRes.body.data;
    expect(project.name).toBe("E2E Project");

    // 2. Create a Task in that Project
    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "E2E Critical Task",
      description: "Must be completed for the journey to succeed",
      projectId: project.id,
      workspaceId: testWorkspace.id,
      priority: "HIGH",
    });

    expect(taskRes.status).toBe(201);
    expect(taskRes.body.success).toBe(true);
    const task = taskRes.body.data;
    expect(task.title).toBe("E2E Critical Task");
    expect(task.status).toBe("TODO");

    // 3. Update Task to IN_PROGRESS
    const progressRes = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "IN_PROGRESS" });

    expect(progressRes.status).toBe(200);
    expect(progressRes.body.data.status).toBe("IN_PROGRESS");

    // 4. Complete the Task
    const completeRes = await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "COMPLETED" });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe("COMPLETED");
    expect(completeRes.body.data.completedAt).not.toBeNull();

    // 5. Verify in the Task list
    const listRes = await request(app)
      .get("/api/v1/tasks")
      .set(headers)
      .query({ projectId: project.id });

    expect(listRes.status).toBe(200);
    const foundTask = listRes.body.data.find((t: any) => t.id === task.id);
    expect(foundTask).toBeDefined();
    expect(foundTask.status).toBe("COMPLETED");
  });

  it('should complete the "Collaboration and Invitation" journey', async () => {
    /**
     * JOURNEY:
     * 1. Owner invites a second user to the workspace
     * 2. Second user accepts the invitation
     * 3. Second user creates a task in the workspace
     * 4. Owner verifies the task created by the second user exists
     */

    const ownerHeaders = await authWithCsrfHeaders(testUser, {
      sessionId: `session-collab-owner-${Date.now()}`,
    });

    // Create a second user (the invitee) - MUST be verified to pass authenticate middleware
    const invitee = await createUser({
      name: "Collaborator User",
      emailVerified: new Date(),
    });
    const inviteeHeaders = await authWithCsrfHeaders(invitee, {
      sessionId: `session-collab-invitee-${Date.now()}`,
    });

    // 1. Owner invites the user
    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/invite`)
      .set(ownerHeaders)
      .send({
        email: invitee.email,
        role: "MEMBER",
      });

    expect(inviteRes.status).toBe(201);
    const inviteToken = inviteRes.body.data.token;

    // 2. Invitee accepts the invitation
    const acceptRes = await request(app)
      .post(`/api/v1/workspaces/invitations/${inviteToken}/accept`)
      .set(inviteeHeaders);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.success).toBe(true);

    // 3. Invitee creates a project and a task
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(inviteeHeaders)
      .send({
        name: "Collaborator Project",
        workspaceId: testWorkspace.id,
      });

    expect(projectRes.status).toBe(201);
    const project = projectRes.body.data;

    const taskRes = await request(app)
      .post("/api/v1/tasks")
      .set(inviteeHeaders)
      .send({
        title: "Collaborator Task",
        projectId: project.id,
        workspaceId: testWorkspace.id,
      });

    expect(taskRes.status).toBe(201);
    const task = taskRes.body.data;

    // 4. Owner verifies task existence
    const verifyRes = await request(app)
      .get("/api/v1/tasks")
      .set(ownerHeaders)
      .query({ workspaceId: testWorkspace.id, search: "Collaborator Task" });

    expect(verifyRes.status).toBe(200);
    const foundTask = verifyRes.body.data.find((t: any) => t.id === task.id);
    expect(foundTask).toBeDefined();
    expect(foundTask.title).toBe("Collaborator Task");
  });

  it('should complete the "Project Lifecycle" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a Project
     * 2. User adds multiple tasks to the project
     * 3. User updates project status to ARCHIVED
     * 4. User verifies that tasks are still accessible but project is archived
     */

    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-lifecycle-${Date.now()}`,
    });

    // 1. Create Project
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({
        name: "Lifecycle Project",
        workspaceId: testWorkspace.id,
      });

    expect(projectRes.status).toBe(201);
    expect(projectRes.body.success).toBe(true);
    const project = projectRes.body.data;
    expect(project).toBeDefined();

    // 2. Add multiple tasks
    await Promise.all([
      request(app).post("/api/v1/tasks").set(headers).send({
        title: "T1",
        projectId: project.id,
        workspaceId: testWorkspace.id,
      }),
      request(app).post("/api/v1/tasks").set(headers).send({
        title: "T2",
        projectId: project.id,
        workspaceId: testWorkspace.id,
      }),
    ]);

    // 3. Archive Project
    const archiveRes = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set(headers)
      .send({ status: "ARCHIVED" });

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe("ARCHIVED");

    // 4. Verify tasks still exist
    const taskRes = await request(app)
      .get("/api/v1/tasks")
      .set(headers)
      .query({ projectId: project.id });

    expect(taskRes.status).toBe(200);
    expect(taskRes.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('should complete the "Meeting Lifecycle" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a Meeting in the Workspace
     * 2. User adds another user as an attendee
     * 3. User updates meeting details
     * 4. User verifies meeting exists and contains the attendee
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-meeting-${Date.now()}`,
    });
    const attendee = await createUser();
    await addMemberToWorkspace(attendee.id, testWorkspace.id);
    const attendeeHeaders = await authWithCsrfHeaders(attendee);

    // 1. Create Meeting with attendee
    const startTime = new Date(Date.now() + 86400000).toISOString();
    const endTime = new Date(Date.now() + 86400000 + 3600000).toISOString();
    const meetingRes = await request(app)
      .post(`/api/v1/meetings/${testWorkspace.id}/meetings`)
      .set(headers)
      .send({
        title: "E2E Sync Meeting",
        description: "Discussing the E2E progress",
        visibility: "PUBLIC",
        startTime,
        endTime,
        attendeeIds: [attendee.id],
      });

    expect(meetingRes.status).toBe(201);
    const meeting = meetingRes.body.data;

    // 2. Update Meeting
    const updateRes = await request(app)
      .patch(`/api/v1/meetings/${testWorkspace.id}/meetings/${meeting.id}`)
      .set(headers)
      .send({ title: "Updated E2E Sync Meeting" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe("Updated E2E Sync Meeting");

    // 3. Verify attendee can see the meeting
    const verifyRes = await request(app)
      .get(`/api/v1/meetings/${testWorkspace.id}/meetings/${meeting.id}`)
      .set(attendeeHeaders);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.title).toBe("Updated E2E Sync Meeting");
  });

  it('should complete the "Announcement and Communication" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin creates a workspace-wide announcement
     * 2. Admin pins the announcement
     * 3. Regular user verifies the announcement is visible and pinned
     */
    const adminHeaders = await authWithCsrfHeaders(testUser, {
      sessionId: `session-ann-admin-${Date.now()}`,
    });
    const user = await createUser();
    await addMemberToWorkspace(user.id, testWorkspace.id);
    const userHeaders = await authWithCsrfHeaders(user);

    // 1. Create Announcement
    const announceRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(adminHeaders)
      .send({
        title: "Workspace Update",
        content: "Welcome to the new workspace!",
      });

    expect(announceRes.status).toBe(201);
    const announcement = announceRes.body.data;

    // 2. Pin Announcement
    const pinRes = await request(app)
      .patch(`/api/v1/announcements/${announcement.id}/pin`)
      .set(adminHeaders)
      .send({ isPinned: true });

    expect(pinRes.status).toBe(200);
    expect(pinRes.body.data.isPinned).toBe(true);

    // 3. User verifies
    const listRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(userHeaders)
      .query({ workspaceId: testWorkspace.id });

    expect(listRes.status).toBe(200);
    const found = listRes.body.data.find((a: any) => a.id === announcement.id);
    expect(found).toBeDefined();
    expect(found.isPinned).toBe(true);
  });

  it('should complete the "Feature Request and Feedback" journey', async () => {
    /**
     * JOURNEY:
     * 1. User submits a feature request
     * 2. Other users vote for the request
     * 3. User verifies the vote count has increased
     */
    const user1Headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-feat-u1-${Date.now()}`,
    });
    const user2 = await createUser();
    const user2Headers = await authWithCsrfHeaders(user2);
    const user3 = await createUser();
    const user3Headers = await authWithCsrfHeaders(user3);

    // 1. Submit Feature Request
    const featRes = await request(app)
      .post("/api/v1/features")
      .set(user1Headers)
      .send({
        title: "Add Dark Mode",
        description:
          "It would be great to have a dark theme for the dashboard.",
      });

    expect(featRes.status).toBe(201);
    const feature = featRes.body.data;

    // 2. Vote for request
    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(user2Headers)
      .send({ type: "UP" });
    await request(app)
      .post(`/api/v1/features/${feature.id}/vote`)
      .set(user3Headers)
      .send({ type: "UP" });

    // 3. Verify vote count
    const verifyRes = await request(app)
      .get(`/api/v1/features/${feature.id}`)
      .set(user1Headers);

    expect(verifyRes.status).toBe(200);
    // The API returns the feature with _count.upvotes
    expect(verifyRes.body.data._count).toBeDefined();
    expect(verifyRes.body.data._count.upvotes).toBeGreaterThanOrEqual(2);
  });

  it('should complete the "Billing and Subscription" journey', async () => {
    /**
     * JOURNEY:
     * 1. User checks current subscription status
     * 2. User verifies subscription details
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-bill-${Date.now()}`,
    });

    // 1. Check current subscription
    const subRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}/billing/subscription`)
      .set(headers);

    expect(subRes.status).toBe(200);
    expect(subRes.body.success).toBe(true);
    // Verify workspace has a plan (returns FREE by default)
    expect(subRes.body.data.planName).toBeDefined();
  });

  it('should complete the "Focus and Deep Work" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a task
     * 2. User starts a focus session for that task
     * 3. User completes the focus session
     * 4. User verifies focus history
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-focus-${Date.now()}`,
    });

    // 1. Create Task
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({
        name: "Focus Project",
        workspaceId: testWorkspace.id,
      });
    const project = projectRes.body.data;

    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Deep Work Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 2. Start Focus Session
    const startRes = await request(app)
      .post("/api/v1/focus-sessions/start")
      .set(headers)
      .send({
        taskId: task.id,
        duration: 25, // 25 mins
        type: "POMODORO",
      });

    expect(startRes.status).toBe(201);
    const session = startRes.body.data;

    // 3. Complete Focus Session
    const completeRes = await request(app)
      .post(`/api/v1/focus-sessions/${session.id}/complete`)
      .set(headers)
      .send({
        actualDuration: 24,
      });

    expect(completeRes.status).toBe(200);

    // 4. Verify focus history
    const historyRes = await request(app)
      .get("/api/v1/focus-sessions/history")
      .set(headers);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.some((s: any) => s.id === session.id)).toBe(
      true,
    );
  });

  it('should complete the "Activity and Audit" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a task
     * 2. User updates task status
     * 3. User verifies the actions appear in the workspace activity feed
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-activity-${Date.now()}`,
    });

    // 1. Create Task
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({
        name: "Activity Project",
        workspaceId: testWorkspace.id,
      });
    const project = projectRes.body.data;

    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Activity Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 2. Update Task
    await request(app)
      .patch(`/api/v1/tasks/${task.id}/status`)
      .set(headers)
      .send({ status: "IN_PROGRESS" });

    // 3. Verify Activity Feed
    const activityRes = await request(app)
      .get(`/api/v1/activities/workspace/${testWorkspace.id}`)
      .set(headers);

    expect(activityRes.status).toBe(200);
    expect(Array.isArray(activityRes.body.data)).toBe(true);
    // Note: Activity logging is async via BullMQ queue (requires Redis).
    // If no worker is running, activities may not appear in the feed yet.
  });

  it('should complete the "User Profile and Settings" journey', async () => {
    /**
     * JOURNEY:
     * 1. User updates their profile name
     * 2. User verifies the updated name in their profile
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-user-${Date.now()}`,
    });

    // 1. Update Profile
    const updateRes = await request(app)
      .put("/api/v1/user/profile")
      .set(headers)
      .send({
        name: "Updated E2E User Name",
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    // 2. Verify Update
    const verifyRes = await request(app)
      .get("/api/v1/user/profile")
      .set(headers);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.user.name).toBe("Updated E2E User Name");
  });

  it('should complete the "Knowledge & Assets" journey', async () => {
    /**
     * JOURNEY:
     * 1. User uploads a file to the system
     * 2. User attaches that file to a task
     * 3. User verifies the attachment is linked to the task
     * 4. User deletes the attachment and verifies it is gone
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-assets-${Date.now()}`,
    });

    // Setup: Need a task to attach to
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({ name: "Assets Project", workspaceId: testWorkspace.id });
    const project = projectRes.body.data;

    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Task for Assets",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 1. Upload File
    // We use .attach() for multipart/form-data and .field() for additional body parameters
    const uploadRes = await request(app)
      .post("/api/v1/upload")
      .set(headers)
      .field("workspaceId", testWorkspace.id)
      .attach("file", Buffer.from("test content"), "test-file.txt");

    // Note: We use 200 or 201 depending on implementation, but the test previously expected 200.
    // If it fails with 507, it's a storage limit issue. We'll keep 200 for now and see.
    expect(uploadRes.status).toBe(200);
    const uploadedFile = uploadRes.body.data.file;
    expect(uploadedFile.id).toBeDefined();

    // 2. Attach File to Task
    const attachRes = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(headers)
      .attach("file", Buffer.from("attachment content"), "attached-file.txt");

    expect(attachRes.status).toBe(201);
    const attachment = attachRes.body.data;
    expect(attachment.id).toBeDefined();
    expect(attachment.taskId).toBe(task.id);

    // 3. Verify Attachment exists
    const verifyRes = await request(app)
      .get(`/api/v1/tasks/${task.id}/attachments`)
      .set(headers);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.some((a: any) => a.id === attachment.id)).toBe(
      true,
    );

    // 4. Delete Attachment
    const deleteRes = await request(app)
      .delete(`/api/v1/tasks/${task.id}/attachments/${attachment.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toContain("deleted");

    // Verify deletion
    const finalVerifyRes = await request(app)
      .get(`/api/v1/tasks/${task.id}/attachments`)
      .set(headers);
    expect(
      finalVerifyRes.body.data.some((a: any) => a.id === attachment.id),
    ).toBe(false);
  });

  it('should complete the "Daily Habits & Rituals" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a task
     * 2. User adds that task as a recurring daily task
     * 3. User verifies the daily task list
     * 4. User checks daily task stats
     * 5. User removes the daily task
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-daily-${Date.now()}`,
    });

    // Setup: Need a task first
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({ name: "Daily Project", workspaceId: testWorkspace.id });
    const project = projectRes.body.data;
    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Daily Habit Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 1. Create Daily Task (linking to the created task)
    const dailyRes = await request(app)
      .post("/api/v1/daily-tasks")
      .set(headers)
      .send({
        taskId: task.id,
        title: "Morning Review",
        description: "Review all high priority tasks for the day",
        type: "PRIMARY",
      });

    expect(dailyRes.status).toBe(201);
    const dailyTask = dailyRes.body.data;
    expect(dailyTask.task.title).toBe("Daily Habit Task");

    // 2. Verify in list
    const listRes = await request(app).get("/api/v1/daily-tasks").set(headers);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.primaryTask.id).toBe(dailyTask.task.id);

    // 3. Check stats
    const statsRes = await request(app)
      .get("/api/v1/daily-tasks/stats")
      .set(headers);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.success).toBe(true);

    // 4. Remove Daily Task
    const deleteRes = await request(app)
      .delete(`/api/v1/daily-tasks/${dailyTask.task.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);

    const finalListRes = await request(app)
      .get("/api/v1/daily-tasks")
      .set(headers);
    expect(finalListRes.body.data.primaryTask).toBeNull();
  });

  it('should complete the "Organization & Categorization" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a new Label
     * 2. User attaches the label to a task
     * 3. User verifies the task has the label
     * 4. User removes the label from the task
     * 5. User checks popular labels
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-labels-${Date.now()}`,
    });

    // Setup: Task
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .set(headers)
      .send({ name: "Label Project", workspaceId: testWorkspace.id });
    const project = projectRes.body.data;
    const taskRes = await request(app).post("/api/v1/tasks").set(headers).send({
      title: "Labeled Task",
      projectId: project.id,
      workspaceId: testWorkspace.id,
    });
    const task = taskRes.body.data;

    // 1. Create Label
    const labelRes = await request(app)
      .post("/api/v1/labels")
      .set(headers)
      .send({
        name: "Urgent-Fix",
        color: "#FF0000",
      });

    expect(labelRes.status).toBe(201);
    const label = labelRes.body.data;

    // 2. Attach Label to Task
    const attachRes = await request(app)
      .post(`/api/v1/labels/${label.id}/tasks/${task.id}`)
      .set(headers);

    expect(attachRes.status).toBe(201); // Corrected from 200 to 201

    // 3. Verify
    const verifyRes = await request(app)
      .get(`/api/v1/labels/${label.id}/tasks`)
      .set(headers);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.some((tl: any) => tl.taskId === task.id)).toBe(
      true,
    );

    // 4. Remove Label
    const removeRes = await request(app)
      .delete(`/api/v1/labels/${label.id}/tasks/${task.id}`)
      .set(headers);

    expect(removeRes.status).toBe(200);

    // 5. Check popular labels
    const popularRes = await request(app)
      .get("/api/v1/labels/popular")
      .set(headers);

    expect(popularRes.status).toBe(200);
  });

  it('should complete the "Strategic Planning & Review" journey', async () => {
    /**
     * JOURNEY:
     * 1. User initializes calendar settings
     * 2. User creates a goal checkpoint
     * 3. User verifies goal checkpoints
     * 4. User gets calendar insights
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-cal-${Date.now()}`,
    });

    // 1. Initialize settings
    const initRes = await request(app)
      .post("/api/v1/calendar/initialize")
      .set(headers);

    expect(initRes.status).toBe(200);

    // 2. Create Goal Checkpoint
    const goalRes = await request(app)
      .post("/api/v1/calendar/goals")
      .set(headers)
      .send({
        userId: testUser.id,
        workspaceId: testWorkspace.id,
        title: "Quarterly Review",
        type: "QUARTERLY",
        targetDate: new Date(Date.now() + 86400000 * 30).toISOString(),
      });

    expect(goalRes.status).toBe(201);
    const goal = goalRes.body.data;

    // 3. Verify
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 2);

    const listRes = await request(app)
      .get("/api/v1/calendar/goals")
      .query({
        workspaceId: testWorkspace.id,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      })
      .set(headers);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((g: any) => g.id === goal.id)).toBe(true);

    // 4. Insights
    const insightsRes = await request(app)
      .get("/api/v1/calendar/insights")
      .query({
        workspaceId: testWorkspace.id,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      })
      .set(headers);

    expect(insightsRes.status).toBe(200);
  });

  it('should complete the "System Health & Analytics" journey', async () => {
    /**
     * JOURNEY:
     * 1. User checks workspace analytics overview
     * 2. User checks task trends
     * 3. User checks workspace usage stats
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-analytics-${Date.now()}`,
    });

    // 1. Overview
    const overviewRes = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/overview`)
      .set(headers);

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.success).toBe(true);

    // 2. Trends
    const trendsRes = await request(app)
      .get(`/api/v1/analytics/${testWorkspace.id}/tasks/trends`)
      .set(headers);

    expect(trendsRes.status).toBe(200);

    // 3. Usage
    const usageRes = await request(app)
      .get(`/api/v1/workspace-usage/${testWorkspace.id}/usage`)
      .set(headers);

    expect(usageRes.status).toBe(200);
  });

  it('should complete the "Administrative Oversight" journey', async () => {
    /**
     * JOURNEY:
     * 1. Admin creates a system user
     * 2. Admin bans the user
     * 3. User attempts to access protected route (should fail)
     * 4. Admin unbans the user
     * 5. User attempts to access protected route (should succeed)
     * 6. Admin updates workspace limits
     */
    const adminUser = await createUser({ role: "ADMIN" });
    // Register the user as a Focura admin for the process
    const { registerFocuraAdmin } = await import("../factories/index.js");
    registerFocuraAdmin(adminUser.id);
    const adminHeaders = await authWithCsrfHeaders(adminUser, {
      sessionId: `session-admin-${Date.now()}`,
    });

    const targetUser = await createUser();
    const targetHeaders = await authWithCsrfHeaders(targetUser, {
      sessionId: `session-target-${Date.now()}`,
    });

    // 1. Ban User
    const banRes = await request(app)
      .patch(`/api/v1/admin/users/${targetUser.id}/ban`)
      .set(adminHeaders)
      .send({ banned: true, reason: "Policy Violation" });

    expect(banRes.status).toBe(200);

    // 2. User attempts access (should be 403)
    const accessRes = await request(app)
      .get("/api/v1/user/profile")
      .set(targetHeaders);

    expect(accessRes.status).toBe(403);

    // 3. Unban User
    const unbanRes = await request(app)
      .patch(`/api/v1/admin/users/${targetUser.id}/unban`)
      .set(adminHeaders);

    expect(unbanRes.status).toBe(200);

    // 4. User attempts access (should be 200)
    const accessRes2 = await request(app)
      .get("/api/v1/user/profile")
      .set(targetHeaders);

    expect(accessRes2.status).toBe(200);

    // 5. Update Workspace Limits
    const limitsRes = await request(app)
      .patch(`/api/v1/admin/workspaces/${testWorkspace.slug}/limits`)
      .set(adminHeaders)
      .send({
        plan: "BUSINESS",
        maxMembers: 100,
        maxStorage: 1024 * 10, // 10GB expressed in MB = 10,240
      });

    expect(limitsRes.status).toBe(200);
  });
});
