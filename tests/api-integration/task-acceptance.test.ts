import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function createTask(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  userId?: string,
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Ship the release notes",
      description: "",
      priority: "no-priority",
      status: "to-do",
      userId,
    }),
  });
}

async function assignTask(
  app: ReturnType<typeof createApp>["app"],
  taskId: string,
  userId: string,
) {
  return app.request(`/api/task/assignee/${taskId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

async function joinWorkspace(workspaceId: string, userId: string) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role: "member",
    joinedAt: new Date(),
  });
}

async function getTaskRow(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row;
}

async function getAssignments(taskId: string) {
  return db
    .select()
    .from(schema.taskAssignmentTable)
    .where(eq(schema.taskAssignmentTable.taskId, taskId));
}

async function decidePendingTask(
  app: ReturnType<typeof createApp>["app"],
  assignmentId: string,
  workspaceId: string,
  decision: "accepted" | "rejected",
  reason: string | null = null,
) {
  return app.request(`/api/pending-decision/task/${assignmentId}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, decision, reason }),
  });
}

async function listPendingDecisions(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  return app.request(
    `/api/pending-decision?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

async function getNotificationsFor(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.userId, userId));
}

async function getActivitiesFor(taskId: string) {
  return db
    .select()
    .from(schema.activityTable)
    .where(eq(schema.activityTable.taskId, taskId));
}

// The activity event is published fire-and-forget from an EventEmitter
// listener, so give its handler a turn to run before asserting on it.
async function waitForActivity(taskId: string, type: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const activities = await getActivitiesFor(taskId);
    const match = activities.find((a) => a.type === type);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No "${type}" activity recorded for task ${taskId}`);
}

async function getMyTasks(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  return app.request(
    `/api/task/my-tasks?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

describe("API integration: task assignment acceptance", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("leaves task.userId null and creates a pending row when assigning another member", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    const response = await assignTask(app, created.id, member.user.id);
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const assignments = await getAssignments(created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      fromUserId: owner.user.id,
      toUserId: member.user.id,
      status: "pending",
    });
    expect(assignments[0].decidedAt).toBeNull();
  });

  it("sets task.userId immediately and records an accepted row for self-assignment", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    const response = await assignTask(app, created.id, owner.user.id);
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBe(owner.user.id);

    const assignments = await getAssignments(created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      fromUserId: owner.user.id,
      toUserId: owner.user.id,
      status: "accepted",
    });
    expect(assignments[0].decidedAt).not.toBeNull();
  });

  it("supersedes the first pending assignment when reassigned before it is decided", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const first = await createWorkspaceMember({ role: "member" });
    const second = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, first.user.id);
    await joinWorkspace(owner.workspace.id, second.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db.insert(schema.projectMemberTable).values([
      { projectId: project.id, userId: first.user.id, role: "member" },
      { projectId: project.id, userId: second.user.id, role: "member" },
    ]);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    const firstAssign = await assignTask(app, created.id, first.user.id);
    expect(firstAssign.status).toBe(200);

    const secondAssign = await assignTask(app, created.id, second.user.id);
    expect(secondAssign.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const assignments = await getAssignments(created.id);
    expect(assignments).toHaveLength(2);

    const pending = assignments.filter((a) => a.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].toUserId).toBe(second.user.id);

    const superseded = assignments.filter((a) => a.status === "superseded");
    expect(superseded).toHaveLength(1);
    expect(superseded[0].toUserId).toBe(first.user.id);
    expect(superseded[0].decidedAt).not.toBeNull();
  });

  it("supersedes a pending assignment and leaves task.userId null when cleared", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);

    const cleared = await assignTask(app, created.id, "");
    expect(cleared.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const assignments = await getAssignments(created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].status).toBe("superseded");
    expect(assignments[0].toUserId).toBe(member.user.id);
    expect(assignments[0].decidedAt).not.toBeNull();
  });

  it("accepting sets task.userId to the accepter and the assignment to accepted", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "accepted",
    );
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBe(member.user.id);

    const [assignment] = await getAssignments(created.id);
    expect(assignment.status).toBe("accepted");
    expect(assignment.decidedAt).not.toBeNull();
  });

  it("rejecting with a reason leaves task.userId null, records the reason, and notifies the assigner", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "rejected",
      "Too busy this sprint",
    );
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const [assignment] = await getAssignments(created.id);
    expect(assignment.status).toBe("rejected");
    expect(assignment.reason).toBe("Too busy this sprint");
    expect(assignment.decidedAt).not.toBeNull();

    const notifications = await getNotificationsFor(owner.user.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      resourceId: created.id,
      resourceType: "task",
    });
    expect(notifications[0].content).toBe("Too busy this sprint");
  });

  it("rejecting a grandfathered assignment with no assigner still unassigns the task without erroring", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    // Simulate a grandfathered row: nobody recorded who assigned this work.
    const [grandfathered] = await db
      .insert(schema.taskAssignmentTable)
      .values({
        taskId: created.id,
        fromUserId: null,
        toUserId: member.user.id,
        status: "pending",
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      grandfathered.id,
      owner.workspace.id,
      "rejected",
      "Not my area",
    );
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const [assignment] = await getAssignments(created.id);
    expect(assignment.status).toBe("rejected");
    expect(assignment.reason).toBe("Not my area");

    // Nobody to notify, and nobody invented.
    const ownerNotifications = await getNotificationsFor(owner.user.id);
    expect(ownerNotifications).toHaveLength(0);
  });

  it("rejecting with an empty reason returns 400 and changes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "rejected",
      "   ",
    );
    expect(response.status).toBe(400);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();

    const [assignment] = await getAssignments(created.id);
    expect(assignment.status).toBe("pending");
    expect(assignment.reason).toBeNull();
    expect(assignment.decidedAt).toBeNull();
  });

  it("a second decision returns 409", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const first = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "accepted",
    );
    expect(first.status).toBe(200);

    const second = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "rejected",
      "Changed my mind",
    );
    expect(second.status).toBe(409);

    const [assignment] = await getAssignments(created.id);
    expect(assignment.status).toBe("accepted");
  });

  it("does not list a pending assignment for a project the user is not a member of", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);

    // The member is removed from the project after being offered the task.
    await db
      .delete(schema.projectMemberTable)
      .where(
        and(
          eq(schema.projectMemberTable.projectId, project.id),
          eq(schema.projectMemberTable.userId, member.user.id),
        ),
      );

    mockAuthenticatedSession(member.user);
    const response = await listPendingDecisions(app, owner.workspace.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    const taskItems = body.items.filter(
      (item: { source: string }) => item.source === "task",
    );
    expect(taskItems).toHaveLength(0);
  });

  it("excludes a pending assignment from my-tasks and includes it once accepted", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    // Before acceptance: the task must not show up in the assignee's queue.
    mockAuthenticatedSession(member.user);
    const beforeResponse = await getMyTasks(app, owner.workspace.id);
    expect(beforeResponse.status).toBe(200);
    const beforeBody = await beforeResponse.json();
    expect(beforeBody.data.total).toBe(0);
    const beforeTaskIds = beforeBody.data.projects.flatMap(
      (p: { tasks: Array<{ id: string }> }) => p.tasks.map((t) => t.id),
    );
    expect(beforeTaskIds).not.toContain(created.id);

    // After acceptance: the task must appear in the assignee's queue.
    const decision = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "accepted",
    );
    expect(decision.status).toBe(200);

    const afterResponse = await getMyTasks(app, owner.workspace.id);
    expect(afterResponse.status).toBe(200);
    const afterBody = await afterResponse.json();
    expect(afterBody.data.total).toBe(1);
    const afterTaskIds = afterBody.data.projects.flatMap(
      (p: { tasks: Array<{ id: string }> }) => p.tasks.map((t) => t.id),
    );
    expect(afterTaskIds).toContain(created.id);
  });

  it("rejecting a re-offer leaves an incumbent accepted assignee in place", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const incumbent = await createWorkspaceMember({ role: "member" });
    const offeree = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, incumbent.user.id);
    await joinWorkspace(owner.workspace.id, offeree.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db.insert(schema.projectMemberTable).values([
      { projectId: project.id, userId: incumbent.user.id, role: "member" },
      { projectId: project.id, userId: offeree.user.id, role: "member" },
    ]);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    // The incumbent is offered the task and accepts it — they now own it.
    await assignTask(app, created.id, incumbent.user.id);
    const [firstOffer] = (await getAssignments(created.id)).filter(
      (a) => a.status === "pending",
    );
    mockAuthenticatedSession(incumbent.user);
    const accepted = await decidePendingTask(
      app,
      firstOffer.id,
      owner.workspace.id,
      "accepted",
    );
    expect(accepted.status).toBe(200);
    expect((await getTaskRow(created.id)).userId).toBe(incumbent.user.id);

    // The owner re-offers the same task to someone else while the incumbent
    // still holds it. Per assignment-write.ts, the offer leaves task.userId
    // untouched.
    mockAuthenticatedSession(owner.user);
    const reoffer = await assignTask(app, created.id, offeree.user.id);
    expect(reoffer.status).toBe(200);
    expect((await getTaskRow(created.id)).userId).toBe(incumbent.user.id);

    const [secondOffer] = (await getAssignments(created.id)).filter(
      (a) => a.status === "pending",
    );
    expect(secondOffer.toUserId).toBe(offeree.user.id);

    // The offeree declines. The incumbent, who declined nothing, must keep
    // the task.
    mockAuthenticatedSession(offeree.user);
    const rejected = await decidePendingTask(
      app,
      secondOffer.id,
      owner.workspace.id,
      "rejected",
      "Not my area",
    );
    expect(rejected.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBe(incumbent.user.id);

    const rejectedAssignment = (await getAssignments(created.id)).find(
      (a) => a.id === secondOffer.id,
    );
    expect(rejectedAssignment?.status).toBe("rejected");
  });

  it("rejecting an offer on a task that was unassigned leaves it unassigned", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    expect((await getTaskRow(created.id)).userId).toBeNull();

    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "rejected",
      "Not this sprint",
    );
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBeNull();
  });

  it("accepting attributes the activity to the assigner, not to the accepter as a self-assignment", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();
    await assignTask(app, created.id, member.user.id);
    const [pending] = await getAssignments(created.id);

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      pending.id,
      owner.workspace.id,
      "accepted",
    );
    expect(response.status).toBe(200);

    const activity = await waitForActivity(created.id, "assignee_changed");
    expect(activity.userId).toBe(owner.user.id);
    const eventData = activity.eventData as {
      isSelfAssigned: boolean;
      newAssigneeId: string;
    };
    expect(eventData.isSelfAssigned).toBe(false);
    expect(eventData.newAssigneeId).toBe(member.user.id);
  });

  it("accepting an assignment with no recorded assigner does not crash and does not invent one", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await (await createTask(app, project.id)).json();

    // Simulate a grandfathered row: nobody recorded who assigned this work.
    const [grandfathered] = await db
      .insert(schema.taskAssignmentTable)
      .values({
        taskId: created.id,
        fromUserId: null,
        toUserId: member.user.id,
        status: "pending",
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const response = await decidePendingTask(
      app,
      grandfathered.id,
      owner.workspace.id,
      "accepted",
    );
    expect(response.status).toBe(200);

    const task = await getTaskRow(created.id);
    expect(task.userId).toBe(member.user.id);

    const activity = await waitForActivity(created.id, "assignee_changed");
    expect(activity.userId).toBeNull();
    const eventData = activity.eventData as {
      isSelfAssigned: boolean;
      newAssigneeId: string;
    };
    expect(eventData.isSelfAssigned).toBe(false);
    expect(eventData.newAssigneeId).toBe(member.user.id);
  });
});
