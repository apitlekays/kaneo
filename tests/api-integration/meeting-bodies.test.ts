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

type App = ReturnType<typeof createApp>["app"];

function createBody(
  app: App,
  body: {
    workspaceId: string;
    name: string;
    description?: string;
    quorumRule?: string;
  },
) {
  return app.request("/api/meeting/bodies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listBodies(app: App, workspaceId: string, includeInactive?: boolean) {
  const qs = includeInactive
    ? `?workspaceId=${workspaceId}&includeInactive=true`
    : `?workspaceId=${workspaceId}`;
  return app.request(`/api/meeting/bodies${qs}`);
}

function updateBody(
  app: App,
  bodyId: string,
  body: {
    workspaceId: string;
    name?: string;
    description?: string;
    quorumRule?: string;
    active?: boolean;
  },
) {
  return app.request(`/api/meeting/bodies/${bodyId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteBody(app: App, bodyId: string, workspaceId: string) {
  return app.request(
    `/api/meeting/bodies/${bodyId}?workspaceId=${workspaceId}`,
    { method: "DELETE" },
  );
}

function listMembers(app: App, bodyId: string, workspaceId: string) {
  return app.request(
    `/api/meeting/bodies/${bodyId}/members?workspaceId=${workspaceId}`,
  );
}

function addMember(
  app: App,
  bodyId: string,
  body: {
    workspaceId: string;
    userId?: string;
    name?: string;
    role?: string;
  },
) {
  return app.request(`/api/meeting/bodies/${bodyId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function removeMember(
  app: App,
  bodyId: string,
  memberId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/bodies/${bodyId}/members/${memberId}?workspaceId=${workspaceId}`,
    { method: "DELETE" },
  );
}

function createMeeting(
  app: App,
  body: { workspaceId: string; title: string; bodyId?: string },
) {
  return app.request("/api/meeting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adoptMeeting(
  app: App,
  meetingId: string,
  body: { workspaceId: string; adoptedByMeetingId: string },
) {
  return app.request(`/api/meeting/${meetingId}/adopt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: meeting bodies", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("1. a global admin creates a body, adds a chair and a member, lists them back", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const chairUser = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: chairUser.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createBody(app, {
      workspaceId: admin.workspace.id,
      name: "Board of Directors",
      description: "The main governing body",
      quorumRule: "half plus one",
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.name).toBe("Board of Directors");
    expect(body.quorumRule).toBe("half plus one");
    expect(body.active).toBe(true);

    const chairAdd = await addMember(app, body.id, {
      workspaceId: admin.workspace.id,
      userId: chairUser.user.id,
      role: "chair",
    });
    expect(chairAdd.status).toBe(201);
    const chairMember = await chairAdd.json();
    expect(chairMember.role).toBe("chair");
    expect(chairMember.userId).toBe(chairUser.user.id);

    const plainAdd = await addMember(app, body.id, {
      workspaceId: admin.workspace.id,
      name: "External Member",
    });
    expect(plainAdd.status).toBe(201);
    const plainMember = await plainAdd.json();
    expect(plainMember.role).toBe("member");
    expect(plainMember.name).toBe("External Member");

    const listed = await listBodies(app, admin.workspace.id);
    expect(listed.status).toBe(200);
    const bodies = await listed.json();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].id).toBe(body.id);

    const members = await listMembers(app, body.id, admin.workspace.id);
    expect(members.status).toBe(200);
    const memberRows = await members.json();
    expect(memberRows).toHaveLength(2);
  });

  it("2. a GM page holder who is not an admin can list but gets 403 on every write", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const nonAdmin = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: nonAdmin.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(admin.workspace.id, nonAdmin.user.id);

    mockAuthenticatedSession(admin.user);
    const { app: adminApp } = createApp();
    const bodyRes = await createBody(adminApp, {
      workspaceId: admin.workspace.id,
      name: "Committee",
    });
    const body = await bodyRes.json();
    const memberRes = await addMember(adminApp, body.id, {
      workspaceId: admin.workspace.id,
      name: "Seed Member",
    });
    const member = await memberRes.json();

    mockAuthenticatedSession(nonAdmin.user);
    const { app: nonAdminApp } = createApp();

    // Reads succeed.
    const listed = await listBodies(nonAdminApp, admin.workspace.id);
    expect(listed.status).toBe(200);
    const listedMembers = await listMembers(
      nonAdminApp,
      body.id,
      admin.workspace.id,
    );
    expect(listedMembers.status).toBe(200);

    // Every write is refused.
    const createAttempt = await createBody(nonAdminApp, {
      workspaceId: admin.workspace.id,
      name: "Shadow Committee",
    });
    expect(createAttempt.status).toBe(403);

    const updateAttempt = await updateBody(nonAdminApp, body.id, {
      workspaceId: admin.workspace.id,
      name: "Renamed Committee",
    });
    expect(updateAttempt.status).toBe(403);

    const addMemberAttempt = await addMember(nonAdminApp, body.id, {
      workspaceId: admin.workspace.id,
      name: "Interloper",
    });
    expect(addMemberAttempt.status).toBe(403);

    const removeMemberAttempt = await removeMember(
      nonAdminApp,
      body.id,
      member.id,
      admin.workspace.id,
    );
    expect(removeMemberAttempt.status).toBe(403);

    const deleteAttempt = await deleteBody(
      nonAdminApp,
      body.id,
      admin.workspace.id,
    );
    expect(deleteAttempt.status).toBe(403);

    // None of the refused writes actually took effect.
    const [row] = await db
      .select()
      .from(schema.meetingBodyTable)
      .where(eq(schema.meetingBodyTable.id, body.id));
    expect(row.name).toBe("Committee");
    expect(row.active).toBe(true);
  });

  it("3. a member with both userId and name is 400; with neither is 400", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const bodyRes = await createBody(app, {
      workspaceId: admin.workspace.id,
      name: "Validation Body",
    });
    const body = await bodyRes.json();

    const both = await addMember(app, body.id, {
      workspaceId: admin.workspace.id,
      userId: admin.user.id,
      name: "Also a name",
    });
    expect(both.status).toBe(400);

    const neither = await addMember(app, body.id, {
      workspaceId: admin.workspace.id,
    });
    expect(neither.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingBodyMemberTable)
      .where(eq(schema.meetingBodyMemberTable.bodyId, body.id));
    expect(row).toBeUndefined();
  });

  it("4. a body from another workspace is 404", async () => {
    const ownerA = await createWorkspaceMember({ role: "owner" });
    const ownerB = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(ownerA.user);
    const { app: appA } = createApp();
    const created = await createBody(appA, {
      workspaceId: ownerA.workspace.id,
      name: "Workspace A Body",
    });
    const body = await created.json();

    mockAuthenticatedSession(ownerB.user);
    const { app: appB } = createApp();

    const crossGet = await listMembers(appB, body.id, ownerB.workspace.id);
    expect(crossGet.status).toBe(404);

    const crossUpdate = await updateBody(appB, body.id, {
      workspaceId: ownerB.workspace.id,
      name: "Hijacked",
    });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await deleteBody(appB, body.id, ownerB.workspace.id);
    expect(crossDelete.status).toBe(404);

    const crossAddMember = await addMember(appB, body.id, {
      workspaceId: ownerB.workspace.id,
      name: "Intruder",
    });
    expect(crossAddMember.status).toBe(404);
  });

  it("5. deleting a body deactivates it — the row still exists and meetings referencing it still resolve", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createBody(app, {
      workspaceId: admin.workspace.id,
      name: "Legacy Committee",
    });
    const body = await created.json();

    const meetingRes = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Historical Meeting",
      bodyId: body.id,
    });
    expect(meetingRes.status).toBe(201);
    const meeting = await meetingRes.json();

    const deleted = await deleteBody(app, body.id, admin.workspace.id);
    expect(deleted.status).toBe(200);
    const deletedBody = await deleted.json();
    expect(deletedBody.active).toBe(false);

    const [row] = await db
      .select()
      .from(schema.meetingBodyTable)
      .where(eq(schema.meetingBodyTable.id, body.id));
    expect(row).toBeDefined();
    expect(row.active).toBe(false);

    // The default list excludes it, but includeInactive still surfaces it.
    const defaultList = await listBodies(app, admin.workspace.id);
    const defaultBodies = await defaultList.json();
    expect(defaultBodies.find((b: { id: string }) => b.id === body.id)).toBe(
      undefined,
    );
    const fullList = await listBodies(app, admin.workspace.id, true);
    const fullBodies = await fullList.json();
    expect(
      fullBodies.find((b: { id: string }) => b.id === body.id),
    ).toBeDefined();

    // The historical meeting still resolves and still points at the (now
    // inactive) body.
    const [meetingRow] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(meetingRow.bodyId).toBe(body.id);
  });

  it("6. a chair on the meeting's body can adopt it; an ordinary member cannot — exercises canAdoptMeeting's body-role branch", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const chair = await createWorkspaceMember({ role: "member" });
    const plainMember = await createWorkspaceMember({ role: "member" });
    for (const u of [chair, plainMember]) {
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: admin.workspace.id,
        userId: u.user.id,
        role: "member",
        joinedAt: new Date(),
      });
      await grantGeneralManagement(admin.workspace.id, u.user.id);
    }

    mockAuthenticatedSession(admin.user);
    const { app: adminApp } = createApp();

    const bodyRes = await createBody(adminApp, {
      workspaceId: admin.workspace.id,
      name: "Adoption Test Body",
    });
    const body = await bodyRes.json();

    const chairAdd = await addMember(adminApp, body.id, {
      workspaceId: admin.workspace.id,
      userId: chair.user.id,
      role: "chair",
    });
    expect(chairAdd.status).toBe(201);

    const memberAdd = await addMember(adminApp, body.id, {
      workspaceId: admin.workspace.id,
      userId: plainMember.user.id,
      role: "member",
    });
    expect(memberAdd.status).toBe(201);

    const meetingRes = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Body Meeting",
      bodyId: body.id,
    });
    const meeting = await meetingRes.json();
    expect(meeting.bodyId).toBe(body.id);

    const laterMeetingRes = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingId = (await laterMeetingRes.json()).id as string;

    // The ordinary body member (not chair/secretary, not global admin) is
    // refused — this is the same negative branch meeting-crud.test.ts already
    // covers, kept here to show the body created through the new routes
    // behaves identically to one seeded directly via db.insert.
    mockAuthenticatedSession(plainMember.user);
    const { app: memberApp } = createApp();
    const memberAttempt = await adoptMeeting(memberApp, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(memberAttempt.status).toBe(403);

    // The chair — added through POST /bodies/:bodyId/members, not a raw
    // db.insert — succeeds. This is the payoff: the chair role now reaches
    // canAdoptMeeting's chair/secretary branch through real API writes.
    mockAuthenticatedSession(chair.user);
    const { app: chairApp } = createApp();
    const chairAdopt = await adoptMeeting(chairApp, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(chairAdopt.status).toBe(200);
    const adopted = await chairAdopt.json();
    expect(adopted.status).toBe("adopted");
    expect(adopted.adoptedByMeetingId).toBe(laterMeetingId);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.status).toBe("adopted");
    expect(row.adoptedByMeetingId).toBe(laterMeetingId);
  });
});
