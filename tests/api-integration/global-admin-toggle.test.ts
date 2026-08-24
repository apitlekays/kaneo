import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ACCESS_PAGE_SLUGS } from "../../apps/api/src/workspace-access";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function addMember(
  workspaceId: string,
  userId: string,
  role: string,
  previousRole: string | null = null,
) {
  const [row] = await db
    .insert(schema.workspaceUserTable)
    .values({
      workspaceId,
      userId,
      role,
      previousRole,
      joinedAt: new Date(),
    })
    .returning();
  return row;
}

function toggleGlobalAdmin(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  userId: string,
  enabled: boolean,
) {
  return app.request(`/api/workspace-access/${workspaceId}/global-admin`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, enabled }),
  });
}

describe("API integration: global admin promote/demote", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("promotes a manager to global-admin, remembering their prior role", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const member = (
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspaceId))
    ).find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("global-admin");
    expect(member?.previousRole).toBe("manager");
  });

  it("demotes a promoted member back to their remembered role", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "global-admin", "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      false,
    );
    expect(response.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("manager");
    expect(member?.previousRole).toBeNull();
  });

  it("falls back to member when promoting/demoting a member with no previousRole", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "member");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    await toggleGlobalAdmin(app, workspaceId, target.user.id, true);
    await toggleGlobalAdmin(app, workspaceId, target.user.id, false);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("member");
    expect(member?.previousRole).toBeNull();
  });

  it("does not clobber previousRole when promoting an already-promoted member twice", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    await toggleGlobalAdmin(app, workspaceId, target.user.id, true);
    // Second promotion is a no-op: must not overwrite previousRole with
    // "global-admin".
    const second = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(second.status).toBe(200);

    let rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    let member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("global-admin");
    expect(member?.previousRole).toBe("manager");

    await toggleGlobalAdmin(app, workspaceId, target.user.id, false);
    rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    member = rows.find((m) => m.userId === target.user.id);
    expect(member?.role).toBe("manager");
    expect(member?.previousRole).toBeNull();
  });

  it("refuses to change the workspace owner's role", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    const admin = await createWorkspaceMember();
    await addMember(workspaceId, admin.user.id, "global-admin");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      owner.user.id,
      true,
    );
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const ownerRow = rows.find((m) => m.userId === owner.user.id);
    expect(ownerRow?.role).toBe("owner");
    expect(ownerRow?.previousRole).toBeNull();
  });

  it("refuses a non-admin actor and changes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    const actor = await createWorkspaceMember();
    await addMember(workspaceId, actor.user.id, "member");
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    const targetRow = rows.find((m) => m.userId === target.user.id);
    expect(targetRow?.role).toBe("manager");
    expect(targetRow?.previousRole).toBeNull();
  });

  it("404s when the target user is not a member of the workspace", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await toggleGlobalAdmin(
      app,
      workspaceId,
      outsider.user.id,
      true,
    );
    expect(response.status).toBe(404);
  });

  it("grants every access page slug to a promoted member without matrix rows", async () => {
    const admin = await createWorkspaceMember({ role: "global-admin" });
    const workspaceId = admin.workspace.id;
    const target = await createWorkspaceMember();
    await addMember(workspaceId, target.user.id, "manager");

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const promote = await toggleGlobalAdmin(
      app,
      workspaceId,
      target.user.id,
      true,
    );
    expect(promote.status).toBe(200);

    // No explicit matrix grant exists for this member at all.
    const grants = await db
      .select()
      .from(schema.workspacePageAccessTable)
      .where(eq(schema.workspacePageAccessTable.userId, target.user.id));
    expect(grants).toHaveLength(0);

    mockAuthenticatedSession(target.user);
    const meResponse = await app.request(
      `/api/workspace-access/${workspaceId}/me`,
    );
    expect(meResponse.status).toBe(200);
    const body = await meResponse.json();
    expect(body.isAdmin).toBe(true);
    for (const slug of ACCESS_PAGE_SLUGS) {
      expect(body.pages).toContain(slug);
    }
  });
});
