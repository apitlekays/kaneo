import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

/**
 * New workspaces do not auto-seed the four gm_organisation rows — that only
 * happens once, for the workspaces that already existed when migration
 * 0054 ran (see its comment: "New workspaces start empty, like every other
 * gm_* config table"). So each test workspace here gets its own
 * "mapim-malaysia" row inserted directly, each with a distinct id — that
 * distinctness is what makes a cross-workspace organisationId constructible.
 */
async function seedOrganisation(workspaceId: string) {
  const [org] = await db
    .insert(schema.gmOrganisationTable)
    .values({
      workspaceId,
      key: "mapim-malaysia",
      label: "MAPIM Malaysia",
    })
    .returning();
  return org;
}

describe("API integration: organisationId is workspace-scoped", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects capturing a letter with another workspace's organisationId, and creates nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(owner.workspace.id, owner.user.id);
    const other = await createWorkspaceMember({ role: "owner" });
    const otherOrg = await seedOrganisation(other.workspace.id);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/correspondence/letters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        direction: "in",
        type: "external",
        medium: "email",
        subject: "Cross-workspace organisation on capture",
        organisationId: otherOrg.id,
      }),
    });
    expect(response.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.workspaceId, owner.workspace.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects editing a letter to another workspace's organisationId, and leaves the stored organisation unchanged", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(owner.workspace.id, owner.user.id);
    const ownOrg = await seedOrganisation(owner.workspace.id);
    const other = await createWorkspaceMember({ role: "owner" });
    const otherOrg = await seedOrganisation(other.workspace.id);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const created = await (
      await app.request("/api/correspondence/letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          direction: "in",
          type: "external",
          medium: "email",
          subject: "Edit target",
          organisationId: ownOrg.id,
        }),
      })
    ).json();
    expect(created.organisationId).toBe(ownOrg.id);

    const response = await app.request(
      `/api/correspondence/letters/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          organisationId: otherOrg.id,
        }),
      },
    );
    expect(response.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.organisationId).toBe(ownOrg.id);
  });

  it("accepts and stores the caller's own workspace organisationId on capture", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(owner.workspace.id, owner.user.id);
    const ownOrg = await seedOrganisation(owner.workspace.id);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/correspondence/letters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        direction: "in",
        type: "external",
        medium: "email",
        subject: "Own-workspace organisation",
        organisationId: ownOrg.id,
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.organisationId).toBe(ownOrg.id);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.organisationId).toBe(ownOrg.id);
  });
});
