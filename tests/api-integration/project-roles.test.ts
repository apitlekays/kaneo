import { randomUUID } from "node:crypto";
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

type App = ReturnType<typeof createApp>["app"];
type User = typeof schema.userTable.$inferSelect;

/** Add another user to an existing workspace with the given workspace role. */
async function addWorkspaceUser(workspaceId: string, role: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: `User ${role}`,
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return user;
}

async function addToProject(
  projectId: string,
  userId: string,
  role: "member" | "manager" = "member",
) {
  await db
    .insert(schema.projectMemberTable)
    .values({ projectId, userId, role });
}

function as(user: User): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

async function createTask(app: App, projectId: string) {
  const response = await app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Prepare the AGM pack",
      description: "",
      priority: "no-priority",
      status: "to-do",
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; createdBy: string | null };
}

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const setStatus = (app: App, taskId: string, status: string) =>
  app.request(`/api/task/status/${taskId}`, {
    method: "PUT",
    ...json({ status }),
  });

const comment = (app: App, taskId: string) =>
  app.request(`/api/comment/${taskId}`, {
    method: "POST",
    ...json({ content: "Looks good" }),
  });

async function putFullTask(
  app: App,
  taskId: string,
  changes: Partial<{ title: string; status: string; projectId: string }>,
) {
  const [task] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return app.request(`/api/task/${taskId}`, {
    method: "PUT",
    ...json({
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      status: task.status,
      projectId: task.projectId,
      position: task.position ?? 0,
      userId: task.userId ?? undefined,
      ...changes,
    }),
  });
}

describe("API integration: project roles", () => {
  let creator: User;
  let otherMember: User;
  let manager: User;
  let viewer: User;
  let outsider: User;
  let workspaceId: string;
  let projectId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await createWorkspaceMember({ role: "member" });
    creator = seeded.user;
    workspaceId = seeded.workspace.id;
    const { project } = await createProjectFixture({
      workspaceId,
      memberUserId: creator.id,
    });
    projectId = project.id;

    otherMember = await addWorkspaceUser(workspaceId, "member");
    manager = await addWorkspaceUser(workspaceId, "member");
    viewer = await addWorkspaceUser(workspaceId, "viewer");
    outsider = await addWorkspaceUser(workspaceId, "member");
    await addToProject(projectId, otherMember.id);
    await addToProject(projectId, manager.id, "manager");
    await addToProject(projectId, viewer.id);
  });

  it("records who created a task", async () => {
    const task = await createTask(as(creator), projectId);
    expect(task.createdBy).toBe(creator.id);
  });

  describe("a Viewer added to the project can only read", () => {
    it("can open the task and read its comments", async () => {
      const task = await createTask(as(creator), projectId);
      const app = as(viewer);
      expect((await app.request(`/api/task/${task.id}`)).status).toBe(200);
      expect((await app.request(`/api/comment/${task.id}`)).status).toBe(200);
    });

    it("cannot comment, edit, create or delete", async () => {
      const task = await createTask(as(creator), projectId);
      const app = as(viewer);
      expect((await comment(app, task.id)).status).toBe(403);
      expect(
        (
          await app.request(`/api/task/title/${task.id}`, {
            method: "PUT",
            ...json({ title: "Renamed" }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(`/api/task/${projectId}`, {
            method: "POST",
            ...json({
              title: "Nope",
              description: "",
              priority: "no-priority",
              status: "to-do",
            }),
          })
        ).status,
      ).toBe(403);
      expect(
        (await app.request(`/api/task/${task.id}`, { method: "DELETE" }))
          .status,
      ).toBe(403);
    });

    it("stays read-only even as a project manager", async () => {
      await db
        .update(schema.projectMemberTable)
        .set({ role: "manager" })
        .where(eq(schema.projectMemberTable.userId, viewer.id));
      const task = await createTask(as(creator), projectId);
      expect((await setStatus(as(viewer), task.id, "done")).status).toBe(403);
    });
  });

  describe("a Member added to the project", () => {
    it("can comment on and edit any task", async () => {
      const task = await createTask(as(creator), projectId);
      const app = as(otherMember);
      expect((await comment(app, task.id)).status).toBe(200);
      expect(
        (await putFullTask(app, task.id, { title: "Edited" })).status,
      ).toBe(200);
    });

    it("cannot assign tasks in bulk", async () => {
      const task = await createTask(as(creator), projectId);
      const response = await as(otherMember).request("/api/task/bulk", {
        method: "PATCH",
        ...json({
          taskIds: [task.id],
          operation: "updateAssignee",
          value: otherMember.id,
        }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("someone not in the project", () => {
    it("cannot read or comment on its tasks by id", async () => {
      const task = await createTask(as(creator), projectId);
      const app = as(outsider);
      expect((await app.request(`/api/comment/${task.id}`)).status).toBe(403);
      expect((await comment(app, task.id)).status).toBe(403);
      expect((await app.request(`/api/activity/${task.id}`)).status).toBe(403);
    });

    it("does not find its tasks in search", async () => {
      await createTask(as(creator), projectId);
      const response = await as(outsider).request(
        `/api/search?q=AGM&workspaceId=${workspaceId}`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { results: unknown[] };
      expect(body.results).toHaveLength(0);

      const own = await as(creator).request(
        `/api/search?q=AGM&workspaceId=${workspaceId}`,
      );
      const ownBody = (await own.json()) as { results: unknown[] };
      expect(ownBody.results.length).toBeGreaterThan(0);
    });
  });

  describe("deleting a task", () => {
    it("is refused to a member who did not create it", async () => {
      const task = await createTask(as(creator), projectId);
      const response = await as(otherMember).request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
    });

    it("is allowed to its creator and to a project manager", async () => {
      const own = await createTask(as(creator), projectId);
      expect(
        (await as(creator).request(`/api/task/${own.id}`, { method: "DELETE" }))
          .status,
      ).toBe(200);

      const other = await createTask(as(creator), projectId);
      expect(
        (
          await as(manager).request(`/api/task/${other.id}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(200);
    });

    it("refuses a bulk delete that includes someone else's task", async () => {
      const task = await createTask(as(creator), projectId);
      const response = await as(otherMember).request("/api/task/bulk", {
        method: "PATCH",
        ...json({ taskIds: [task.id], operation: "delete" }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("moving a task between columns", () => {
    it("is refused to a member who neither created nor is assigned it", async () => {
      const task = await createTask(as(creator), projectId);
      const app = as(otherMember);
      expect((await setStatus(app, task.id, "in-progress")).status).toBe(403);
      expect(
        (await putFullTask(app, task.id, { status: "in-progress" })).status,
      ).toBe(403);
      const bulk = await app.request("/api/task/bulk", {
        method: "PATCH",
        ...json({
          taskIds: [task.id],
          operation: "updateStatus",
          value: "done",
        }),
      });
      expect(bulk.status).toBe(403);
    });

    it("is allowed to the creator, an assignee and a project manager", async () => {
      const task = await createTask(as(creator), projectId);
      expect(
        (await setStatus(as(creator), task.id, "in-progress")).status,
      ).toBe(200);

      await db
        .insert(schema.taskAssigneeTable)
        .values({ taskId: task.id, userId: otherMember.id, isLead: true });
      expect(
        (await setStatus(as(otherMember), task.id, "in-review")).status,
      ).toBe(200);

      expect((await setStatus(as(manager), task.id, "done")).status).toBe(200);
    });

    it("refuses moving a task into a project the user is not in", async () => {
      const task = await createTask(as(creator), projectId);
      const { project: elsewhere } = await createProjectFixture({
        workspaceId,
      });
      const response = await as(creator).request(`/api/task/move/${task.id}`, {
        method: "PUT",
        ...json({ destinationProjectId: elsewhere.id }),
      });
      expect(response.status).toBe(403);
    });
  });
});
