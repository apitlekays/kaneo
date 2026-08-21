import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

describe("API integration: project creation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated project creation requests", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "workspace-missing",
        name: "Unauthorized Project",
        icon: "Folder",
        slug: "unauthorized-project",
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  it("creates a project for a workspace owner and seeds default columns", async () => {
    // 4f3fa5e1 reserved project:create for owner/global-admin.
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Roadmap",
        icon: "FolderKanban",
        slug: "roadmap",
      }),
    });

    expect(response.status).toBe(200);
    const payload =
      (await response.json()) as typeof schema.projectTable.$inferSelect;

    expect(payload).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Roadmap",
      icon: "FolderKanban",
      slug: "roadmap",
    });

    const persistedProject = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, payload.id),
    });

    expect(persistedProject).toMatchObject({
      id: payload.id,
      workspaceId: member.workspace.id,
      name: "Roadmap",
      slug: "roadmap",
    });

    const columns = await db.query.columnTable.findMany({
      where: eq(schema.columnTable.projectId, payload.id),
      orderBy: (column, { asc }) => [asc(column.position)],
    });

    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(columns.map((column) => column.isFinal)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("rejects project creation for users outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = "user-outsider";

    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Forbidden Project",
        icon: "Folder",
        slug: "forbidden-project",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "You don't have access to this workspace",
    );
  });
});

describe("API integration: project visibility", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("hides projects the caller is not a member of", async () => {
    // A plain workspace member, not an owner: owners are global admins and
    // legitimately see everything, so an owner would prove nothing here.
    const owner = await createWorkspaceMember({ role: "owner" });
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        name: "Outside Member",
        email: `outsider-${randomUUID()}@example.com`,
        emailVerified: true,
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: outsider.id,
      role: "member",
      joinedAt: new Date(),
    });

    const mine = await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Project I Belong To",
      memberUserId: outsider.id,
    });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Project I Am Not On",
    });

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${owner.workspace.id}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((p: { id: string }) => p.id)).toEqual([mine.project.id]);
    // The name alone is disclosure: "Project I Am Not On" must not appear at
    // all, not merely arrive flagged as inaccessible.
    expect(JSON.stringify(body)).not.toContain("Project I Am Not On");
  });

  it("still shows every project to a workspace owner", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Owner Sees This",
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${owner.workspace.id}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
  });
});
