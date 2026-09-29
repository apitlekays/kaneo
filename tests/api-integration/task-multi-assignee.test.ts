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

type App = ReturnType<typeof createApp>["app"];

function json(method: string, body?: unknown) {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function createTask(app: App, projectId: string, extra = {}) {
  return app.request(
    `/api/task/${projectId}`,
    json("POST", {
      title: "Prepare the AGM pack",
      description: "",
      priority: "no-priority",
      status: "to-do",
      ...extra,
    }),
  );
}

const addAssignee = (app: App, taskId: string, userId: string) =>
  app.request(`/api/task/${taskId}/assignees`, json("POST", { userId }));

const removeAssignee = (app: App, taskId: string, userId: string) =>
  app.request(`/api/task/${taskId}/assignees/${userId}`, json("DELETE"));

const setLead = (app: App, taskId: string, userId: string) =>
  app.request(`/api/task/${taskId}/lead`, json("PUT", { userId }));

const assignSingle = (app: App, taskId: string, userId: string) =>
  app.request(`/api/task/assignee/${taskId}`, json("PUT", { userId }));

const decide = (
  app: App,
  assignmentId: string,
  workspaceId: string,
  decision: "accepted" | "rejected",
  reason: string | null = null,
) =>
  app.request(
    `/api/pending-decision/task/${assignmentId}/decide`,
    json("POST", { workspaceId, decision, reason }),
  );

async function taskRow(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row;
}

async function people(taskId: string) {
  const rows = await db
    .select()
    .from(schema.taskAssigneeTable)
    .where(eq(schema.taskAssigneeTable.taskId, taskId));
  return rows.map((r) => ({ userId: r.userId, isLead: r.isLead }));
}

async function pendingOffer(taskId: string, userId: string) {
  const [row] = await db
    .select()
    .from(schema.taskAssignmentTable)
    .where(
      and(
        eq(schema.taskAssignmentTable.taskId, taskId),
        eq(schema.taskAssignmentTable.toUserId, userId),
        eq(schema.taskAssignmentTable.status, "pending"),
      ),
    );
  return row;
}

async function notificationsFor(userId: string, type: string) {
  // Notifications are created by fire-and-forget event listeners.
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, userId),
          eq(schema.notificationTable.type, type),
        ),
      );
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

/** An owner (who manages the project) and three project members. */
async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const members = [];
  for (let i = 0; i < 3; i++) {
    const m = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: m.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    members.push(m.user);
  }
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  await db.insert(schema.projectMemberTable).values(
    members.map((m) => ({
      projectId: project.id,
      userId: m.id,
      role: "member",
    })),
  );

  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  const [a, b, c] = members as [
    (typeof members)[number],
    (typeof members)[number],
    (typeof members)[number],
  ];
  return { app, owner, workspaceId: owner.workspace.id, project, a, b, c };
}

/** Offer a task to someone and accept it as them. */
async function offerAndAccept(
  ctx: Awaited<ReturnType<typeof setup>>,
  taskId: string,
  user: { id: string },
) {
  mockAuthenticatedSession(ctx.owner.user);
  await addAssignee(ctx.app, taskId, user.id);
  const offer = await pendingOffer(taskId, user.id);
  mockAuthenticatedSession(user as never);
  const res = await decide(ctx.app, offer.id, ctx.workspaceId, "accepted");
  expect(res.status, await res.clone().text()).toBe(200);
  mockAuthenticatedSession(ctx.owner.user);
}

describe("API integration: multiple assignees per task", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("offers a task to two people at once; each decides independently and the first to accept leads", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();

    expect((await addAssignee(ctx.app, task.id, ctx.a.id)).status).toBe(200);
    expect((await addAssignee(ctx.app, task.id, ctx.b.id)).status).toBe(200);

    const offerA = await pendingOffer(task.id, ctx.a.id);
    const offerB = await pendingOffer(task.id, ctx.b.id);
    expect(offerA?.exclusive).toBe(false);
    expect(offerB?.exclusive).toBe(false);

    mockAuthenticatedSession(ctx.b);
    await decide(ctx.app, offerB.id, ctx.workspaceId, "accepted");
    mockAuthenticatedSession(ctx.a);
    await decide(ctx.app, offerA.id, ctx.workspaceId, "accepted");

    expect(await people(task.id)).toEqual(
      expect.arrayContaining([
        { userId: ctx.b.id, isLead: true },
        { userId: ctx.a.id, isLead: false },
      ]),
    );
    expect((await taskRow(task.id)).userId).toBe(ctx.b.id);
  });

  it("a rejection affects only the person who rejected", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await addAssignee(ctx.app, task.id, ctx.b.id);
    await addAssignee(ctx.app, task.id, ctx.c.id);

    const offerB = await pendingOffer(task.id, ctx.b.id);
    mockAuthenticatedSession(ctx.b);
    await decide(ctx.app, offerB.id, ctx.workspaceId, "rejected", "On leave");

    expect(await people(task.id)).toEqual([{ userId: ctx.a.id, isLead: true }]);
    expect(await pendingOffer(task.id, ctx.c.id)).toBeDefined();
    expect((await taskRow(task.id)).userId).toBe(ctx.a.id);
  });

  it("adding yourself takes effect at once and makes you lead of an unassigned task", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();

    await addAssignee(ctx.app, task.id, ctx.owner.user.id);
    expect(await people(task.id)).toEqual([
      { userId: ctx.owner.user.id, isLead: true },
    ]);
    expect((await taskRow(task.id)).userId).toBe(ctx.owner.user.id);

    // A second person accepting joins alongside; the lead does not move.
    await offerAndAccept(ctx, task.id, ctx.a);
    expect((await taskRow(task.id)).userId).toBe(ctx.owner.user.id);
    expect(await people(task.id)).toHaveLength(2);
  });

  it("adding someone who already holds an offer or is already on the task is a no-op", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await addAssignee(ctx.app, task.id, ctx.a.id);
    const again = await (await addAssignee(ctx.app, task.id, ctx.a.id)).json();
    expect(again.status).toBe("no-op");

    await offerAndAccept(ctx, task.id, ctx.b);
    const onTask = await (await addAssignee(ctx.app, task.id, ctx.b.id)).json();
    expect(onTask.status).toBe("no-op");
  });

  it("refuses to add someone outside the project", async () => {
    const ctx = await setup();
    const outsider = await createWorkspaceMember({ role: "member" });
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    const res = await addAssignee(ctx.app, task.id, outsider.user.id);
    expect(res.status).toBe(400);
  });

  it("Make lead moves the lead and task.userId follows; a pending person cannot lead", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);
    await addAssignee(ctx.app, task.id, ctx.c.id);

    expect((await setLead(ctx.app, task.id, ctx.b.id)).status).toBe(200);
    expect((await taskRow(task.id)).userId).toBe(ctx.b.id);
    expect(await people(task.id)).toEqual(
      expect.arrayContaining([
        { userId: ctx.a.id, isLead: false },
        { userId: ctx.b.id, isLead: true },
      ]),
    );

    expect((await setLead(ctx.app, task.id, ctx.c.id)).status).toBe(400);
  });

  it("removing the lead hands the lead to the earliest remaining person; removing everyone unassigns", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);
    await offerAndAccept(ctx, task.id, ctx.c);

    await removeAssignee(ctx.app, task.id, ctx.a.id);
    expect((await taskRow(task.id)).userId).toBe(ctx.b.id);

    await removeAssignee(ctx.app, task.id, ctx.b.id);
    await removeAssignee(ctx.app, task.id, ctx.c.id);
    expect((await taskRow(task.id)).userId).toBeNull();
    expect(await people(task.id)).toEqual([]);
  });

  it("removing someone who only holds an offer withdraws it", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await addAssignee(ctx.app, task.id, ctx.a.id);
    const res = await (await removeAssignee(ctx.app, task.id, ctx.a.id)).json();
    expect(res.status).toBe("withdrawn");
    expect(await pendingOffer(task.id, ctx.a.id)).toBeUndefined();
  });

  it("the single-value assignee route still means 'the only assignee' once accepted", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);

    await assignSingle(ctx.app, task.id, ctx.c.id);
    const offer = await pendingOffer(task.id, ctx.c.id);
    expect(offer.exclusive).toBe(true);
    // Until C accepts, the people on the task keep it.
    expect(await people(task.id)).toHaveLength(2);

    mockAuthenticatedSession(ctx.c);
    await decide(ctx.app, offer.id, ctx.workspaceId, "accepted");
    expect(await people(task.id)).toEqual([{ userId: ctx.c.id, isLead: true }]);
    expect((await taskRow(task.id)).userId).toBe(ctx.c.id);
  });

  it("the single-value route clears everyone", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);
    await addAssignee(ctx.app, task.id, ctx.c.id);

    await assignSingle(ctx.app, task.id, "");
    expect(await people(task.id)).toEqual([]);
    expect((await taskRow(task.id)).userId).toBeNull();
    expect(await pendingOffer(task.id, ctx.c.id)).toBeUndefined();
  });

  it("create accepts several people: yourself leads at once, the rest are offered", async () => {
    const ctx = await setup();
    const task = await (
      await createTask(ctx.app, ctx.project.id, {
        userIds: [ctx.owner.user.id, ctx.a.id, ctx.b.id],
      })
    ).json();

    expect(task.userId).toBe(ctx.owner.user.id);
    expect(await people(task.id)).toEqual([
      { userId: ctx.owner.user.id, isLead: true },
    ]);
    expect(await pendingOffer(task.id, ctx.a.id)).toBeDefined();
    expect(await pendingOffer(task.id, ctx.b.id)).toBeDefined();
  });

  it("task payloads list everyone on the task lead first, and everyone offered it", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);
    await setLead(ctx.app, task.id, ctx.b.id);
    await addAssignee(ctx.app, task.id, ctx.c.id);

    const single = await (await ctx.app.request(`/api/task/${task.id}`)).json();
    expect(single.assignees.map((p: { userId: string }) => p.userId)).toEqual([
      ctx.b.id,
      ctx.a.id,
    ]);
    expect(single.assignees[0].isLead).toBe(true);
    expect(single.pendingAssignees).toEqual([
      { userId: ctx.c.id, name: ctx.c.name },
    ]);

    const list = await (
      await ctx.app.request(`/api/task/tasks/${ctx.project.id}`)
    ).json();
    const listed = list.data.columns
      .flatMap((col: { tasks: { id: string }[] }) => col.tasks)
      .filter((t: { id: string }) => t.id === task.id);
    // Several offers and people must not duplicate the task row.
    expect(listed).toHaveLength(1);
    expect(listed[0].assignees).toHaveLength(2);
  });

  it("filters by any assignee, not only the lead", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);

    const list = await (
      await ctx.app.request(
        `/api/task/tasks/${ctx.project.id}?assigneeId=${ctx.b.id}`,
      )
    ).json();
    const ids = list.data.columns.flatMap((col: { tasks: { id: string }[] }) =>
      col.tasks.map((t) => t.id),
    );
    expect(ids).toEqual([task.id]);
  });

  it("the task appears in My tasks for a collaborator, not only the lead", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);

    mockAuthenticatedSession(ctx.b);
    const mine = await (
      await ctx.app.request(
        `/api/task/my-tasks?workspaceId=${encodeURIComponent(ctx.workspaceId)}`,
      )
    ).json();
    const ids = mine.data.projects.flatMap((p: { tasks: { id: string }[] }) =>
      p.tasks.map((t) => t.id),
    );
    expect(ids).toContain(task.id);
  });

  it("a status change notifies every assignee except whoever made it", async () => {
    const ctx = await setup();
    const task = await (await createTask(ctx.app, ctx.project.id)).json();
    await offerAndAccept(ctx, task.id, ctx.a);
    await offerAndAccept(ctx, task.id, ctx.b);

    mockAuthenticatedSession(ctx.a);
    const res = await ctx.app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "in-progress" }),
    );
    expect(res.status, await res.clone().text()).toBe(200);

    expect(
      await notificationsFor(ctx.b.id, "task_status_changed"),
    ).toHaveLength(1);
    expect(
      await notificationsFor(ctx.a.id, "task_status_changed"),
    ).toHaveLength(0);
  });

  it("a subtask is a task: it takes several assignees the same way", async () => {
    const ctx = await setup();
    const parent = await (await createTask(ctx.app, ctx.project.id)).json();
    const child = await (await createTask(ctx.app, ctx.project.id)).json();
    await ctx.app.request(
      "/api/task-relation",
      json("POST", {
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      }),
    );
    await offerAndAccept(ctx, child.id, ctx.a);
    await offerAndAccept(ctx, child.id, ctx.b);

    const relations = await (
      await ctx.app.request(`/api/task-relation/${parent.id}`)
    ).json();
    const sub = relations.find(
      (r: { targetTaskId: string }) => r.targetTaskId === child.id,
    );
    expect(sub.targetTask.assignees).toHaveLength(2);
  });
});
