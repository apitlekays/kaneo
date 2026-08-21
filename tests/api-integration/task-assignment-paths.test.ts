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

async function bulkAssign(
  app: ReturnType<typeof createApp>["app"],
  taskIds: string[],
  value: string | null,
) {
  return app.request("/api/task/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskIds,
      operation: "updateAssignee",
      value,
    }),
  });
}

async function putFullTask(
  app: ReturnType<typeof createApp>["app"],
  task: {
    id: string;
    title: string;
    status: string;
    projectId: string;
    description: string;
    priority: string;
    position: number;
  },
  overrides: Partial<{
    title: string;
    status: string;
    priority: string;
    position: number;
    userId: string | undefined;
  }> = {},
) {
  return app.request(`/api/task/${task.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: overrides.title ?? task.title,
      description: task.description,
      startDate: undefined,
      dueDate: undefined,
      priority: overrides.priority ?? task.priority,
      status: overrides.status ?? task.status,
      projectId: task.projectId,
      position: overrides.position ?? task.position,
      userId: overrides.userId,
    }),
  });
}

async function importTasksReq(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  tasks: Array<{
    title: string;
    status: string;
    userId?: string | null;
  }>,
) {
  return app.request(`/api/task/import/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks }),
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

async function getNotificationsFor(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.userId, userId));
}

describe("API integration: further task.userId assignment paths", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("bulk assignee update", () => {
    it("leaves task.userId null and creates exactly one pending row when assigning another member", async () => {
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

      const response = await bulkAssign(app, [created.id], member.user.id);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.updatedCount).toBe(1);

      const task = await getTaskRow(created.id);
      expect(task.userId).toBeNull();

      const assignments = await getAssignments(created.id);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({
        fromUserId: owner.user.id,
        toUserId: member.user.id,
        status: "pending",
      });
    });

    it("sets task.userId immediately and creates an accepted row for self-assignment", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });

      mockAuthenticatedSession(owner.user);
      const { app } = createApp();

      const created = await (await createTask(app, project.id)).json();

      const response = await bulkAssign(app, [created.id], owner.user.id);
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

    it("supersedes an existing pending assignment; exactly one pending row remains", async () => {
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

      const firstAssign = await bulkAssign(app, [created.id], first.user.id);
      expect(firstAssign.status).toBe(200);

      const secondAssign = await bulkAssign(app, [created.id], second.user.id);
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
    });
  });

  describe("full task PUT", () => {
    it("changing the assignee to another member leaves task.userId null and creates a pending row", async () => {
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

      const response = await putFullTask(app, created, {
        userId: member.user.id,
      });
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
    });

    it("changing only the title on a task with a live pending offer leaves the offer pending and writes no new assignment row", async () => {
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

      const beforeAssignments = await getAssignments(created.id);
      expect(beforeAssignments).toHaveLength(1);
      expect(beforeAssignments[0].status).toBe("pending");

      // The task's userId is still null (the offer hasn't been accepted).
      // The web client always echoes task.userId in the PUT body (see
      // fetchers/task/update-task.ts: `userId: task.userId || ""`), even
      // when only editing the title - so the payload sends userId: "".
      // This must not disturb the live offer.
      const taskBeforeEdit = await getTaskRow(created.id);
      expect(taskBeforeEdit.userId).toBeNull();

      const response = await putFullTask(
        app,
        { ...created, userId: undefined },
        { title: "Ship the release notes (v2)", userId: "" },
      );
      expect(response.status).toBe(200);

      const task = await getTaskRow(created.id);
      expect(task.title).toBe("Ship the release notes (v2)");
      expect(task.userId).toBeNull();

      const assignments = await getAssignments(created.id);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].status).toBe("pending");
      expect(assignments[0].id).toBe(beforeAssignments[0].id);
      expect(assignments[0].decidedAt).toBeNull();
    });
  });

  describe("import tasks", () => {
    it("sets task.userId immediately and creates accepted rows with from_user_id null, never a pending row", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const member = await createWorkspaceMember({ role: "member" });
      await joinWorkspace(owner.workspace.id, member.user.id);

      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
        memberUserId: member.user.id,
      });

      mockAuthenticatedSession(owner.user);
      const { app } = createApp();

      const response = await importTasksReq(app, project.id, [
        {
          title: "Pre-existing work item",
          status: "to-do",
          userId: member.user.id,
        },
      ]);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results.successful).toBe(1);

      const importedTaskId = body.results.tasks[0].task.id;

      const task = await getTaskRow(importedTaskId);
      expect(task.userId).toBe(member.user.id);

      const assignments = await getAssignments(importedTaskId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({
        fromUserId: null,
        toUserId: member.user.id,
        status: "accepted",
      });
      expect(assignments[0].decidedAt).not.toBeNull();
    });
  });

  describe("assignment-write no-op / pending-supersede edge cases", () => {
    it("reassigning to the current owner while a pending offer to someone else exists supersedes that offer", async () => {
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

      // Owner self-assigns first: task.userId = owner, accepted row.
      await assignTask(app, created.id, owner.user.id);

      // Owner then offers the task to member: pending row created,
      // task.userId stays owner (untouched by the offer).
      await assignTask(app, created.id, member.user.id);
      const midAssignments = await getAssignments(created.id);
      expect(midAssignments.filter((a) => a.status === "pending")).toHaveLength(
        1,
      );

      // Owner reasserts themselves as assignee (userId === existing
      // task.userId, currentUserId === owner too). This is NOT a true
      // no-op because a live pending offer to member exists - it must be
      // superseded, or member would keep a stale prompt for a task owner
      // just reclaimed.
      const reclaim = await assignTask(app, created.id, owner.user.id);
      expect(reclaim.status).toBe(200);

      const task = await getTaskRow(created.id);
      expect(task.userId).toBe(owner.user.id);

      const finalAssignments = await getAssignments(created.id);
      const pending = finalAssignments.filter((a) => a.status === "pending");
      expect(pending).toHaveLength(0);

      const superseded = finalAssignments.filter(
        (a) => a.status === "superseded",
      );
      expect(superseded.length).toBeGreaterThanOrEqual(1);
      expect(superseded.some((a) => a.toUserId === member.user.id)).toBe(true);
    });

    it("does not notify the offeree that the task is assigned to them while the offer is only pending", async () => {
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

      const assignments = await getAssignments(created.id);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].status).toBe("pending");

      // The task is only offered, not theirs - the pending-decision surface
      // (not this event) is the offeree's notification. task_assignee_changed
      // must not fire until acceptance (see pending-decision/providers/task.ts).
      const notifications = await getNotificationsFor(member.user.id);
      const assigneeChangedNotifications = notifications.filter(
        (n) => n.type === "task_assignee_changed",
      );
      expect(assigneeChangedNotifications).toHaveLength(0);
    });

    it("clearing an already-unassigned task with no pending offer does not republish task.unassigned", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });

      mockAuthenticatedSession(owner.user);
      const { app } = createApp();

      const created = await (await createTask(app, project.id)).json();

      // Nothing to clear, nothing pending: this must be a true no-op.
      const first = await assignTask(app, created.id, "");
      expect(first.status).toBe(200);

      const assignmentsAfterFirst = await getAssignments(created.id);
      expect(assignmentsAfterFirst).toHaveLength(0);

      const second = await assignTask(app, created.id, "");
      expect(second.status).toBe(200);

      const task = await getTaskRow(created.id);
      expect(task.userId).toBeNull();

      // Still nothing: no assignment rows were ever written for this
      // idempotent clear-of-nothing.
      const assignments = await getAssignments(created.id);
      expect(assignments).toHaveLength(0);
    });
  });
});
