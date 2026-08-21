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
});
