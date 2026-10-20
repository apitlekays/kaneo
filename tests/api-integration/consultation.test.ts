import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];
type User = typeof schema.userTable.$inferSelect;
type ProjectRow = { id: string; kind: string; name: string };

function as(user: User): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function addStaff(workspaceId: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: "Consultant",
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role: "member",
    joinedAt: new Date(),
  });
  return user;
}

function createProject(
  app: App,
  workspaceId: string,
  kind?: "project" | "consultation",
) {
  return app.request(
    "/api/project",
    json("POST", {
      workspaceId,
      name: kind === "consultation" ? "Tax advisory 2026" : "Office move",
      icon: "Layout",
      slug: kind === "consultation" ? "TAX" : "OFF",
      ...(kind ? { kind } : {}),
    }),
  );
}

async function listProjects(app: App, workspaceId: string) {
  const res = await app.request(`/api/project?workspaceId=${workspaceId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ProjectRow[];
}

function createTask(app: App, projectId: string) {
  return app.request(
    `/api/task/${projectId}`,
    json("POST", {
      title: "Draft the advisory memo",
      description: "",
      priority: "no-priority",
      status: "to-do",
    }),
  );
}

describe("API integration: consultations", () => {
  let admin: User;
  let staff: User;
  let workspaceId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    const seeded = await createWorkspaceMember({ role: "owner" });
    admin = seeded.user;
    workspaceId = seeded.workspace.id;
    staff = await addStaff(workspaceId);
  });

  const grant = (allowed: boolean) =>
    as(admin).request(
      `/api/workspace-access/${workspaceId}`,
      json("PUT", { userId: staff.id, pageSlug: "consultations", allowed }),
    );

  async function consultationWithStaffMember() {
    const res = await createProject(as(admin), workspaceId, "consultation");
    expect(res.status).toBe(200);
    const consultation = (await res.json()) as ProjectRow;
    await db
      .insert(schema.projectMemberTable)
      .values({ projectId: consultation.id, userId: staff.id });
    return consultation;
  }

  it("only a global admin creates a consultation", async () => {
    expect(
      (await createProject(as(staff), workspaceId, "consultation")).status,
    ).toBe(403);

    const consultation = (await (
      await createProject(as(admin), workspaceId, "consultation")
    ).json()) as ProjectRow;
    expect(consultation.kind).toBe("consultation");

    // Without a kind it is an ordinary project, exactly as before.
    const project = (await (
      await createProject(as(admin), workspaceId)
    ).json()) as ProjectRow;
    expect(project.kind).toBe("project");
  });

  it("needs the Consultations grant on top of membership", async () => {
    const consultation = await consultationWithStaffMember();
    const app = as(staff);

    expect(await listProjects(app, workspaceId)).toEqual([]);
    expect((await app.request(`/api/project/${consultation.id}`)).status).toBe(
      403,
    );
    expect((await createTask(app, consultation.id)).status).toBe(403);

    expect((await grant(true)).status).toBe(200);
    const granted = as(staff);
    expect(
      (await listProjects(granted, workspaceId)).map((p) => [p.id, p.kind]),
    ).toEqual([[consultation.id, "consultation"]]);
    expect(
      (await granted.request(`/api/project/${consultation.id}`)).status,
    ).toBe(200);
    expect((await createTask(granted, consultation.id)).status).toBe(200);

    // Taking the grant away puts the membership back to sleep.
    expect((await grant(false)).status).toBe(200);
    expect(
      (await as(staff).request(`/api/project/${consultation.id}`)).status,
    ).toBe(403);
  });

  it("keeps a consultation's tasks out of search without the grant", async () => {
    const consultation = await consultationWithStaffMember();
    expect((await createTask(as(admin), consultation.id)).status).toBe(200);
    const search = async () =>
      (
        (await (
          await as(staff).request(
            `/api/search?q=advisory&workspaceId=${workspaceId}`,
          )
        ).json()) as { results: unknown[] }
      ).results.length;

    expect(await search()).toBe(0);
    await grant(true);
    expect(await search()).toBeGreaterThan(0);
  });

  it("assigns and notifies on a consultation's tasks like a project's", async () => {
    const consultation = await consultationWithStaffMember();
    await grant(true);
    const task = (await (
      await createTask(as(admin), consultation.id)
    ).json()) as {
      id: string;
    };

    const assigned = await as(admin).request(
      `/api/task/assignee/${task.id}`,
      json("PUT", { userId: staff.id }),
    );
    expect(assigned.status).toBe(200);

    const pending = (await (
      await as(staff).request(
        `/api/pending-decision?workspaceId=${workspaceId}`,
      )
    ).json()) as { items?: { kind?: string }[] } | { kind?: string }[];
    const items = Array.isArray(pending) ? pending : (pending.items ?? []);
    expect(items.length).toBeGreaterThan(0);

    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, staff.id));
    expect(notifications.length).toBeGreaterThan(0);
  });
});
