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

function listMeetingTypes(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  includeInactive?: boolean,
) {
  const query = includeInactive
    ? `?workspaceId=${workspaceId}&includeInactive=true`
    : `?workspaceId=${workspaceId}`;
  return app.request(`/api/correspondence/config/meeting-types${query}`);
}

function createMeetingType(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  key: string,
  label: string,
) {
  return app.request("/api/correspondence/config/meeting-types", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, key, label }),
  });
}

describe("API integration: meeting types config resource", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets a global admin create, list, update and deactivate a meeting type", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeetingType(
      app,
      admin.workspace.id,
      "agm",
      "Annual General Meeting",
    );
    expect(created.status).toBe(201);
    const meetingType = await created.json();
    expect(meetingType.key).toBe("agm");
    expect(meetingType.label).toBe("Annual General Meeting");
    expect(meetingType.active).toBe(true);

    const listed = await listMeetingTypes(app, admin.workspace.id);
    expect(listed.status).toBe(200);
    const list = await listed.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(meetingType.id);

    const updated = await app.request(
      `/api/correspondence/config/meeting-types/${meetingType.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: admin.workspace.id,
          label: "Annual General Meeting (Updated)",
        }),
      },
    );
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(updatedBody.label).toBe("Annual General Meeting (Updated)");
    expect(updatedBody.key).toBe("agm");

    const deactivated = await app.request(
      `/api/correspondence/config/meeting-types/${meetingType.id}?workspaceId=${admin.workspace.id}`,
      { method: "DELETE" },
    );
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toEqual({ success: true });

    const [row] = await db
      .select()
      .from(schema.meetingTypeTable)
      .where(eq(schema.meetingTypeTable.id, meetingType.id));
    expect(row.active).toBe(false);
  });

  it("lets a non-admin GM page holder list meeting types but refuses create, update and deactivate", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app: officerApp } = createApp();
    const created = await createMeetingType(
      officerApp,
      officer.workspace.id,
      "quarterly-committee",
      "Quarterly Committee Meeting",
    );
    expect(created.status).toBe(201);
    const meetingType = await created.json();

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();

    // The page holder can list — it is reference data the meeting UI needs.
    const listed = await listMeetingTypes(clerkApp, officer.workspace.id);
    expect(listed.status).toBe(200);
    const list = await listed.json();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe("quarterly-committee");

    // But every write is refused.
    const createAttempt = await createMeetingType(
      clerkApp,
      officer.workspace.id,
      "egm",
      "Extraordinary General Meeting",
    );
    expect(createAttempt.status).toBe(403);

    const updateAttempt = await clerkApp.request(
      `/api/correspondence/config/meeting-types/${meetingType.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          label: "Hijacked label",
        }),
      },
    );
    expect(updateAttempt.status).toBe(403);

    const deactivateAttempt = await clerkApp.request(
      `/api/correspondence/config/meeting-types/${meetingType.id}?workspaceId=${officer.workspace.id}`,
      { method: "DELETE" },
    );
    expect(deactivateAttempt.status).toBe(403);

    // Confirm none of the refused writes actually landed.
    const [row] = await db
      .select()
      .from(schema.meetingTypeTable)
      .where(eq(schema.meetingTypeTable.id, meetingType.id));
    expect(row.label).toBe("Quarterly Committee Meeting");
    expect(row.active).toBe(true);
    const stillOne = await listMeetingTypes(clerkApp, officer.workspace.id);
    expect(await stillOne.json()).toHaveLength(1);
  });

  it("hides a deactivated meeting type from the default list but shows it with includeInactive", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeetingType(
      app,
      admin.workspace.id,
      "egm",
      "Extraordinary General Meeting",
    );
    const meetingType = await created.json();

    const deactivated = await app.request(
      `/api/correspondence/config/meeting-types/${meetingType.id}?workspaceId=${admin.workspace.id}`,
      { method: "DELETE" },
    );
    expect(deactivated.status).toBe(200);

    const defaultList = await listMeetingTypes(app, admin.workspace.id);
    expect(await defaultList.json()).toHaveLength(0);

    const withInactive = await listMeetingTypes(app, admin.workspace.id, true);
    const inactiveList = await withInactive.json();
    expect(inactiveList).toHaveLength(1);
    expect(inactiveList[0].id).toBe(meetingType.id);
    expect(inactiveList[0].active).toBe(false);
  });

  it("rejects two meeting types with the same key in one workspace", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const first = await createMeetingType(
      app,
      admin.workspace.id,
      "agm",
      "Annual General Meeting",
    );
    expect(first.status).toBe(201);

    const second = await createMeetingType(
      app,
      admin.workspace.id,
      "agm",
      "Duplicate Annual General Meeting",
    );
    // The unique constraint on (workspaceId, key) fires; the registrar
    // surfaces it as a client error, not a raw 500 from the DB driver.
    expect(second.status).toBe(409);

    const rows = await db
      .select()
      .from(schema.meetingTypeTable)
      .where(eq(schema.meetingTypeTable.workspaceId, admin.workspace.id));
    expect(rows).toHaveLength(1);
  });
});
