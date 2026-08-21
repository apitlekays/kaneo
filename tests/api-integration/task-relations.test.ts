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
  title: string,
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      description: "",
      priority: "no-priority",
      status: "to-do",
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

async function getTaskRelations(
  app: ReturnType<typeof createApp>["app"],
  taskId: string,
) {
  const response = await app.request(`/api/task-relation/${taskId}`);
  expect(response.status).toBe(200);
  return response.json();
}

describe("API integration: task relations carry pendingAssigneeName", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("surfaces pendingAssigneeName for a related task in the SAME project with a pending offer", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const source = await (
      await createTask(app, project.id, "Source task")
    ).json();
    const target = await (
      await createTask(app, project.id, "Awaiting-offer subtask")
    ).json();

    // Offer (not accept) the target task to `member` — task.userId stays
    // null and a `pending` task_assignment row is created.
    const offerResponse = await assignTask(app, target.id, member.user.id);
    expect(offerResponse.status).toBe(200);

    const relResp = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: source.id,
        targetTaskId: target.id,
        relationType: "subtask",
      }),
    });
    expect(relResp.status).toBe(200);

    const relations = (await getTaskRelations(app, source.id)) as Array<{
      sourceTaskId: string;
      targetTaskId: string;
      targetTask: { id: string; pendingAssigneeName: string | null } | null;
    }>;

    const relation = relations.find((rel) => rel.targetTaskId === target.id);
    expect(relation).toBeDefined();
    expect(relation?.targetTask?.pendingAssigneeName).toBe(member.user.name);
  });

  it("surfaces pendingAssigneeName for a related task in a DIFFERENT project (cross-project relation)", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await createWorkspaceMember({ role: "member" });
    await joinWorkspace(owner.workspace.id, member.user.id);

    const { project: projectA } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Project A",
    });
    const { project: projectB } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Project B",
      memberUserId: member.user.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const source = await (
      await createTask(app, projectA.id, "Task in project A")
    ).json();
    const target = await (
      await createTask(app, projectB.id, "Task in project B, awaiting offer")
    ).json();

    // Offer the cross-project task to `member`: task.userId stays null,
    // a `pending` task_assignment row is created for the target task,
    // which lives in a *different* project than the source task.
    const offerResponse = await assignTask(app, target.id, member.user.id);
    expect(offerResponse.status).toBe(200);

    const relResp = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: source.id,
        targetTaskId: target.id,
        relationType: "related",
      }),
    });
    expect(relResp.status).toBe(200);

    const relations = (await getTaskRelations(app, source.id)) as Array<{
      sourceTaskId: string;
      targetTaskId: string;
      targetTask: {
        id: string;
        projectId: string;
        pendingAssigneeName: string | null;
      } | null;
    }>;

    const relation = relations.find((rel) => rel.targetTaskId === target.id);
    expect(relation).toBeDefined();
    // Confirm this genuinely is a cross-project relation, not an
    // accidental same-project one.
    expect(relation?.targetTask?.projectId).toBe(projectB.id);
    expect(relation?.targetTask?.projectId).not.toBe(source.projectId);
    // The regression this covers: the web-side workaround only ever
    // enriched relation objects from the *current project's* own task
    // list, so a target task belonging to a different project silently
    // fell back to "unassigned" with no hint anyone was ever offered it.
    // The join in get-task-relations.ts must supply this directly.
    expect(relation?.targetTask?.pendingAssigneeName).toBe(member.user.name);
  });

  it("leaves pendingAssigneeName null for a related task with no pending offer", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const source = await (
      await createTask(app, project.id, "Source task")
    ).json();
    const target = await (
      await createTask(app, project.id, "Plain unassigned target")
    ).json();

    const relResp = await app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: source.id,
        targetTaskId: target.id,
        relationType: "related",
      }),
    });
    expect(relResp.status).toBe(200);

    const relations = (await getTaskRelations(app, source.id)) as Array<{
      targetTaskId: string;
      targetTask: { pendingAssigneeName: string | null } | null;
    }>;

    const relation = relations.find((rel) => rel.targetTaskId === target.id);
    expect(relation).toBeDefined();
    expect(relation?.targetTask?.pendingAssigneeName ?? null).toBeNull();
  });
});
