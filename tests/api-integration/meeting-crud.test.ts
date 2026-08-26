import { randomUUID } from "node:crypto";
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

function createMeeting(
  app: App,
  body: {
    workspaceId: string;
    title: string;
    bodyId?: string;
    confidential?: boolean;
  },
) {
  return app.request("/api/meeting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getMeeting(app: App, id: string, workspaceId: string) {
  return app.request(`/api/meeting/${id}?workspaceId=${workspaceId}`);
}

function addAttendee(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    userId?: string;
    name?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/attendees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function addMinuteItem(
  app: App,
  meetingId: string,
  body: { workspaceId: string; agenda: string },
) {
  return app.request(`/api/meeting/${meetingId}/minute-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateMinuteItem(
  app: App,
  meetingId: string,
  itemId: string,
  body: { workspaceId: string; agenda?: string; decision?: string },
) {
  return app.request(`/api/meeting/${meetingId}/minute-items/${itemId}`, {
    method: "PUT",
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

async function seedBody(workspaceId: string) {
  const [body] = await db
    .insert(schema.meetingBodyTable)
    .values({ workspaceId, name: `Board ${randomUUID()}` })
    .returning();
  return body;
}

async function seedBodyMember(
  bodyId: string,
  userId: string,
  role: "chair" | "secretary" | "member",
) {
  await db.insert(schema.meetingBodyMemberTable).values({
    bodyId,
    userId,
    role,
  });
}

describe("API integration: meeting CRUD", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("1. a GM page holder creates a meeting, adds attendees and minute items, and reads it back", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const body = await seedBody(admin.workspace.id);

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Q3 Board Meeting",
      bodyId: body.id,
    });
    expect(created.status).toBe(201);
    const meeting = await created.json();
    expect(meeting.status).toBe("draft");
    expect(meeting.bodyId).toBe(body.id);

    const attendeeByUser = await addAttendee(app, meeting.id, {
      workspaceId: admin.workspace.id,
      userId: admin.user.id,
    });
    expect(attendeeByUser.status).toBe(201);

    const attendeeByName = await addAttendee(app, meeting.id, {
      workspaceId: admin.workspace.id,
      name: "External Observer",
    });
    expect(attendeeByName.status).toBe(201);

    const minuteItem = await addMinuteItem(app, meeting.id, {
      workspaceId: admin.workspace.id,
      agenda: "Approve last quarter's budget",
    });
    expect(minuteItem.status).toBe(201);

    const detail = await getMeeting(app, meeting.id, admin.workspace.id);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.attendees).toHaveLength(2);
    expect(detailBody.minuteItems).toHaveLength(1);
    expect(detailBody.minuteItems[0].agenda).toBe(
      "Approve last quarter's budget",
    );
  });

  it("2. a standalone meeting (no bodyId) works end to end", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Ad-hoc Standalone Meeting",
    });
    expect(created.status).toBe(201);
    const meeting = await created.json();
    expect(meeting.bodyId).toBeNull();

    const attendee = await addAttendee(app, meeting.id, {
      workspaceId: admin.workspace.id,
      userId: admin.user.id,
    });
    expect(attendee.status).toBe(201);

    const minuteItem = await addMinuteItem(app, meeting.id, {
      workspaceId: admin.workspace.id,
      agenda: "Discuss office relocation",
    });
    expect(minuteItem.status).toBe(201);

    const detail = await getMeeting(app, meeting.id, admin.workspace.id);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.bodyId).toBeNull();
    expect(detailBody.attendees).toHaveLength(1);
    expect(detailBody.minuteItems).toHaveLength(1);

    // Adoption on a standalone meeting: no body means no body role, so only
    // a global admin (which this creator is, being the workspace owner) may
    // adopt it.
    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: `later-${randomUUID()}`,
    });
    expect(adopted.status).toBe(200);
    const adoptedBody = await adopted.json();
    expect(adoptedBody.status).toBe("adopted");
    expect(adoptedBody.bodyId).toBeNull();
  });

  it("3. confidentiality: non-attendee gets 403 on confidential, 200 on normal; global admin gets 200 on both", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: outsider.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(admin.workspace.id, outsider.user.id);

    mockAuthenticatedSession(admin.user);
    const { app: adminApp } = createApp();

    const normalCreated = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Open Session",
      confidential: false,
    });
    const normalMeeting = await normalCreated.json();

    const confidentialCreated = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "In-Camera Session",
      confidential: true,
    });
    const confidentialMeeting = await confidentialCreated.json();

    mockAuthenticatedSession(outsider.user);
    const { app: outsiderApp } = createApp();

    const outsiderOnNormal = await getMeeting(
      outsiderApp,
      normalMeeting.id,
      admin.workspace.id,
    );
    expect(outsiderOnNormal.status).toBe(200);

    const outsiderOnConfidential = await getMeeting(
      outsiderApp,
      confidentialMeeting.id,
      admin.workspace.id,
    );
    expect(outsiderOnConfidential.status).toBe(403);

    mockAuthenticatedSession(admin.user);
    const { app: adminApp2 } = createApp();

    const adminOnNormal = await getMeeting(
      adminApp2,
      normalMeeting.id,
      admin.workspace.id,
    );
    expect(adminOnNormal.status).toBe(200);

    const adminOnConfidential = await getMeeting(
      adminApp2,
      confidentialMeeting.id,
      admin.workspace.id,
    );
    expect(adminOnConfidential.status).toBe(200);
  });

  it("4. a meeting in another workspace is 404, not 403", async () => {
    const ownerA = await createWorkspaceMember({ role: "owner" });
    const ownerB = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(ownerA.user);
    const { app: appA } = createApp();
    const created = await createMeeting(appA, {
      workspaceId: ownerA.workspace.id,
      title: "Workspace A Meeting",
      confidential: true,
    });
    const meeting = await created.json();

    mockAuthenticatedSession(ownerB.user);
    const { app: appB } = createApp();
    const crossWorkspace = await getMeeting(
      appB,
      meeting.id,
      ownerB.workspace.id,
    );
    expect(crossWorkspace.status).toBe(404);
  });

  it("5. an attendee with both userId and name is 400; with neither is 400", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Attendee Validation Meeting",
    });
    const meeting = await created.json();

    const both = await app.request(`/api/meeting/${meeting.id}/attendees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: admin.workspace.id,
        userId: admin.user.id,
        name: "Also a name",
      }),
    });
    expect(both.status).toBe(400);

    const neither = await app.request(`/api/meeting/${meeting.id}/attendees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: admin.workspace.id }),
    });
    expect(neither.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingAttendeeTable)
      .where(eq(schema.meetingAttendeeTable.meetingId, meeting.id));
    expect(row).toBeUndefined();
  });

  it("6. adoption: chair succeeds and records adoptedByMeetingId; an ordinary member is refused; a second adopt is 409", async () => {
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

    const body = await seedBody(admin.workspace.id);
    await seedBodyMember(body.id, chair.user.id, "chair");
    await seedBodyMember(body.id, plainMember.user.id, "member");

    mockAuthenticatedSession(admin.user);
    const { app: adminApp } = createApp();
    const created = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Committee Meeting",
      bodyId: body.id,
    });
    const meeting = await created.json();

    const laterMeetingId = `later-${randomUUID()}`;

    // An ordinary member (not chair/secretary, not global admin) is refused.
    mockAuthenticatedSession(plainMember.user);
    const { app: memberApp } = createApp();
    const memberAttempt = await adoptMeeting(memberApp, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(memberAttempt.status).toBe(403);

    // The chair succeeds.
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
    expect(adopted.adoptedAt).not.toBeNull();

    // A second adopt attempt claims no rows — 409, not a silent overwrite.
    const secondAdopt = await adoptMeeting(chairApp, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: `another-${randomUUID()}`,
    });
    expect(secondAdopt.status).toBe(409);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.adoptedByMeetingId).toBe(laterMeetingId);
  });

  it("7. editing a minute item on an adopted meeting is 409", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Meeting To Adopt",
    });
    const meeting = await created.json();

    const minuteItemRes = await addMinuteItem(app, meeting.id, {
      workspaceId: admin.workspace.id,
      agenda: "Original agenda text",
    });
    const minuteItem = await minuteItemRes.json();

    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: `later-${randomUUID()}`,
    });
    expect(adopted.status).toBe(200);

    const editAttempt = await updateMinuteItem(app, meeting.id, minuteItem.id, {
      workspaceId: admin.workspace.id,
      agenda: "Trying to rewrite history",
    });
    expect(editAttempt.status).toBe(409);

    const [row] = await db
      .select()
      .from(schema.meetingMinuteItemTable)
      .where(eq(schema.meetingMinuteItemTable.id, minuteItem.id));
    expect(row.agenda).toBe("Original agenda text");
  });
});
