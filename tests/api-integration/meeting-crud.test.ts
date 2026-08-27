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

function removeAttendee(
  app: App,
  meetingId: string,
  attendeeId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/${meetingId}/attendees/${attendeeId}?workspaceId=${workspaceId}`,
    { method: "DELETE" },
  );
}

function updateMeeting(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    title?: string;
    bodyId?: string;
    meetingTypeId?: string;
    confidential?: boolean;
  },
) {
  return app.request(`/api/meeting/${meetingId}`, {
    method: "PUT",
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
    // adopt it. `adoptedByMeetingId` must resolve to a real meeting in this
    // workspace — see idInWorkspace in the adopt route.
    const laterMeeting = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingBody = await laterMeeting.json();

    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingBody.id,
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

  it("6. adoption: chair succeeds and records adoptedByMeetingId; an ordinary member is refused; a second adopt is 409; a confidential meeting refuses a non-attendee chair and never leaks its title (F2)", async () => {
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
    // F2: this meeting is confidential and the chair is deliberately NOT an
    // attendee — the exact vulnerable shape the audit found: body-role
    // adoption authority does not imply confidentiality read access.
    const created = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "IN-CAMERA COMMITTEE MEETING",
      bodyId: body.id,
      confidential: true,
    });
    const meeting = await created.json();

    // `adoptedByMeetingId` must resolve to a real meeting in this workspace
    // (see idInWorkspace in the adopt route), so seed two real "later"
    // meetings rather than fabricating ids.
    const laterMeetingRes = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingId = (await laterMeetingRes.json()).id as string;
    const anotherLaterMeetingRes = await createMeeting(adminApp, {
      workspaceId: admin.workspace.id,
      title: "Another Later Ratifying Meeting",
    });
    const anotherLaterMeetingId = (await anotherLaterMeetingRes.json())
      .id as string;

    // An ordinary member (not chair/secretary, not global admin) is refused.
    mockAuthenticatedSession(plainMember.user);
    const { app: memberApp } = createApp();
    const memberAttempt = await adoptMeeting(memberApp, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(memberAttempt.status).toBe(403);

    // The chair has adoption authority via the body role, but is NOT an
    // attendee of this confidential meeting — F2 says this must be refused,
    // and the refusal body must never carry the sealed title.
    mockAuthenticatedSession(chair.user);
    const { app: chairApp } = createApp();
    const chairAttemptWhileNotAttendee = await adoptMeeting(
      chairApp,
      meeting.id,
      { workspaceId: admin.workspace.id, adoptedByMeetingId: laterMeetingId },
    );
    expect(chairAttemptWhileNotAttendee.status).toBe(403);
    const refusalText = await chairAttemptWhileNotAttendee.text();
    expect(refusalText).not.toContain("IN-CAMERA COMMITTEE MEETING");

    const [stillDraft] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(stillDraft.status).toBe("draft");
    expect(stillDraft.adoptedByMeetingId).toBeNull();

    // Once the chair is also an attendee (i.e. can actually read the
    // meeting), adoption succeeds — body-role authority AND read access,
    // not either alone. The session mock is global, not per-`app` handle —
    // switch back to admin before reusing it, same as everywhere else in
    // this suite.
    mockAuthenticatedSession(admin.user);
    const { app: adminApp2 } = createApp();
    const addChairAsAttendee = await addAttendee(adminApp2, meeting.id, {
      workspaceId: admin.workspace.id,
      userId: chair.user.id,
    });
    expect(addChairAsAttendee.status).toBe(201);

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
      adoptedByMeetingId: anotherLaterMeetingId,
    });
    expect(secondAdopt.status).toBe(409);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.adoptedByMeetingId).toBe(laterMeetingId);
  });

  it("6b. a meeting cannot adopt itself (F8)", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Self-Adoption Attempt",
    });
    const meeting = await created.json();

    const selfAdopt = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: meeting.id,
    });
    expect(selfAdopt.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.status).toBe("draft");
    expect(row.adoptedByMeetingId).toBeNull();
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

    const laterMeetingRes = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingId = (await laterMeetingRes.json()).id as string;

    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
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

  it("8. adopting with a meeting id from another workspace is refused (400)", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const otherOwner = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession(otherOwner.user);
    const { app: otherApp } = createApp();
    const otherWorkspaceMeeting = await createMeeting(otherApp, {
      workspaceId: otherOwner.workspace.id,
      title: "Other Workspace's Later Meeting",
    });
    const otherWorkspaceMeetingId = (await otherWorkspaceMeeting.json())
      .id as string;

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Meeting To Adopt",
    });
    const meeting = await created.json();

    const crossWorkspaceAdopt = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: otherWorkspaceMeetingId,
    });
    expect(crossWorkspaceAdopt.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.status).toBe("draft");
    expect(row.adoptedByMeetingId).toBeNull();
  });

  it("9. a dangling adoptedByMeetingId (its target meeting later deleted) renders as absent, not a crash, in the detail route", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Meeting To Adopt",
    });
    const meeting = await created.json();

    const laterMeetingRes = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingId = (await laterMeetingRes.json()).id as string;

    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(adopted.status).toBe(200);

    // The column deliberately carries no FK: deleting the later meeting
    // leaves adoptedByMeetingId dangling rather than cascading.
    await db
      .delete(schema.meetingTable)
      .where(eq(schema.meetingTable.id, laterMeetingId));

    const detail = await getMeeting(app, meeting.id, admin.workspace.id);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.adoptedByMeetingId).toBe(laterMeetingId);
    expect(detailBody.adoptedByMeeting).toBeNull();
  });

  it("10. F1: the creator of a meeting later marked confidential cannot re-grant themselves read access by adding themselves as an attendee, nor flip confidential back off", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const creator = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: creator.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(admin.workspace.id, creator.user.id);

    mockAuthenticatedSession(creator.user);
    const { app: creatorApp } = createApp();
    const created = await createMeeting(creatorApp, {
      workspaceId: admin.workspace.id,
      title: "Routine catch-up",
    });
    const meeting = await created.json();
    expect(meeting.createdBy).toBe(creator.user.id);

    // A global admin later locks it down. The creator is NOT made an
    // attendee.
    mockAuthenticatedSession(admin.user);
    const { app: adminApp } = createApp();
    const sealed = await updateMeeting(adminApp, meeting.id, {
      workspaceId: admin.workspace.id,
      title: "IN CAMERA: DISMISSAL OF JANE DOE",
      confidential: true,
    });
    expect(sealed.status).toBe(200);

    mockAuthenticatedSession(creator.user);
    const { app: creatorApp2 } = createApp();
    const blockedDetail = await getMeeting(
      creatorApp2,
      meeting.id,
      admin.workspace.id,
    );
    expect(blockedDetail.status).toBe(403);

    // F1: writing themselves into the attendee list — the confidentiality
    // ACL — must be refused, not silently grant read access back.
    const selfEnrol = await addAttendee(creatorApp2, meeting.id, {
      workspaceId: admin.workspace.id,
      userId: creator.user.id,
    });
    expect(selfEnrol.status).toBe(403);

    const stillBlockedDetail = await getMeeting(
      creatorApp2,
      meeting.id,
      admin.workspace.id,
    );
    expect(stillBlockedDetail.status).toBe(403);

    const [attendeeRow] = await db
      .select()
      .from(schema.meetingAttendeeTable)
      .where(eq(schema.meetingAttendeeTable.meetingId, meeting.id));
    expect(attendeeRow).toBeUndefined();

    // The same seam must also refuse flipping `confidential` back off.
    const unseal = await updateMeeting(creatorApp2, meeting.id, {
      workspaceId: admin.workspace.id,
      confidential: false,
    });
    expect(unseal.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.id, meeting.id));
    expect(row.confidential).toBe(true);
  });

  it("11. F3: removing an attendee that doesn't exist (or belongs to a different meeting) is 404, not a false success", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const meetingA = await (
      await createMeeting(app, {
        workspaceId: admin.workspace.id,
        title: "Meeting A",
      })
    ).json();
    const meetingB = await (
      await createMeeting(app, {
        workspaceId: admin.workspace.id,
        title: "Meeting B",
      })
    ).json();

    const attendeeRes = await addAttendee(app, meetingB.id, {
      workspaceId: admin.workspace.id,
      name: "External Observer",
    });
    const attendee = await attendeeRes.json();

    // Wrong meeting: the attendee belongs to B, not A.
    const wrongMeeting = await removeAttendee(
      app,
      meetingA.id,
      attendee.id,
      admin.workspace.id,
    );
    expect(wrongMeeting.status).toBe(404);

    // Non-existent attendee id entirely.
    const nonExistent = await removeAttendee(
      app,
      meetingA.id,
      "does-not-exist",
      admin.workspace.id,
    );
    expect(nonExistent.status).toBe(404);

    // The row is untouched by either failed attempt.
    const [row] = await db
      .select()
      .from(schema.meetingAttendeeTable)
      .where(eq(schema.meetingAttendeeTable.id, attendee.id));
    expect(row).toBeDefined();

    // The real deletion still works and is reported correctly.
    const realDelete = await removeAttendee(
      app,
      meetingB.id,
      attendee.id,
      admin.workspace.id,
    );
    expect(realDelete.status).toBe(200);
    const [gone] = await db
      .select()
      .from(schema.meetingAttendeeTable)
      .where(eq(schema.meetingAttendeeTable.id, attendee.id));
    expect(gone).toBeUndefined();
  });

  it("12. F4: an attendee userId from a foreign workspace is refused, same as the body-member route", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const foreignOwner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Tenancy Test Meeting",
    });
    const meeting = await created.json();

    const crossTenant = await addAttendee(app, meeting.id, {
      workspaceId: admin.workspace.id,
      userId: foreignOwner.user.id,
    });
    expect(crossTenant.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingAttendeeTable)
      .where(eq(schema.meetingAttendeeTable.meetingId, meeting.id));
    expect(row).toBeUndefined();
  });

  it("13. F5: an empty-string bodyId/meetingTypeId is treated as absent, not a 500", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const createdWithEmptyBody = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Empty bodyId on create",
      // Exercising a raw "" — the value a client-side <select> that clears
      // its selection actually sends.
      bodyId: "",
    });
    expect(createdWithEmptyBody.status).toBe(201);
    const created = await createdWithEmptyBody.json();
    expect(created.bodyId).toBeNull();

    const updatedWithEmptyType = await app.request(
      `/api/meeting/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: admin.workspace.id,
          meetingTypeId: "",
        }),
      },
    );
    expect(updatedWithEmptyType.status).toBe(200);
    const updated = await updatedWithEmptyType.json();
    expect(updated.meetingTypeId).toBeNull();

    const updatedWithEmptyBody = await app.request(
      `/api/meeting/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: admin.workspace.id, bodyId: "" }),
      },
    );
    expect(updatedWithEmptyBody.status).toBe(200);
    const updatedBody = await updatedWithEmptyBody.json();
    expect(updatedBody.bodyId).toBeNull();
  });

  it("14. F9: an unparseable scheduledAt is refused with 400, not silently dropped", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Garbage date meeting",
      // @ts-expect-error — deliberately not a real date string.
      scheduledAt: "next friday",
    });
    expect(created.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingTable)
      .where(eq(schema.meetingTable.title, "Garbage date meeting"));
    expect(row).toBeUndefined();
  });

  it("15. F12: new actions can still be recorded against an adopted meeting; attendees and minute items remain frozen", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const created = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Meeting To Adopt For Actions",
    });
    const meeting = await created.json();

    const laterMeetingRes = await createMeeting(app, {
      workspaceId: admin.workspace.id,
      title: "Later Ratifying Meeting",
    });
    const laterMeetingId = (await laterMeetingRes.json()).id as string;

    const adopted = await adoptMeeting(app, meeting.id, {
      workspaceId: admin.workspace.id,
      adoptedByMeetingId: laterMeetingId,
    });
    expect(adopted.status).toBe(200);

    // Actions stay mutable per the module's stated rule — this must NOT 409.
    const actionRes = await app.request(`/api/meeting/${meeting.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: admin.workspace.id,
        description: "Follow up after adoption",
      }),
    });
    expect(actionRes.status).toBe(201);

    // Attendees and minute items are still frozen.
    const attendeeAttempt = await addAttendee(app, meeting.id, {
      workspaceId: admin.workspace.id,
      name: "Late Arrival",
    });
    expect(attendeeAttempt.status).toBe(409);

    const minuteItemAttempt = await addMinuteItem(app, meeting.id, {
      workspaceId: admin.workspace.id,
      agenda: "New item after adoption",
    });
    expect(minuteItemAttempt.status).toBe(409);
  });
});
