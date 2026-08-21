import { eq } from "drizzle-orm";
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
});
