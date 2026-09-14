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

// The presign route calls into the S3 presigner, which only computes a
// signature locally — it never contacts the endpoint. Fake, stable
// credentials are enough for it to run in the integration environment,
// which otherwise leaves S3 unconfigured. Same pattern as
// minute-updates.test.ts.
process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

type App = ReturnType<typeof createApp>["app"];

function createMeeting(
  app: App,
  body: { workspaceId: string; title: string; confidential?: boolean },
) {
  return app.request("/api/meeting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAction(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    description: string;
    assigneeId?: string;
    dueAt?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function addAttendee(
  app: App,
  meetingId: string,
  workspaceId: string,
  userId: string,
) {
  return app.request(`/api/meeting/${meetingId}/attendees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, userId }),
  });
}

function postUpdate(
  app: App,
  meetingId: string,
  actionId: string,
  body: { workspaceId: string; body: string; statusAfter?: string },
) {
  return app.request(`/api/meeting/${meetingId}/actions/${actionId}/updates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listUpdates(
  app: App,
  meetingId: string,
  actionId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/${meetingId}/actions/${actionId}/updates?workspaceId=${workspaceId}`,
  );
}

function presignAttachment(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    actionUpdateId?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/attachments/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "laporan.pdf",
      mimeType: "application/pdf",
      size: 1024,
      ...body,
    }),
  });
}

function finalizeAttachment(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    objectKey: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    actionUpdateId?: string;
  },
) {
  return app.request(`/api/meeting/${meetingId}/attachments/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "laporan.pdf",
      mimeType: "application/pdf",
      size: 1024,
      ...body,
    }),
  });
}

function downloadAttachment(
  app: App,
  meetingId: string,
  docId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/${meetingId}/attachments/${docId}/download?workspaceId=${workspaceId}`,
  );
}

function completeAction(
  app: App,
  meetingId: string,
  actionId: string,
  body: { workspaceId: string },
) {
  return app.request(`/api/meeting/${meetingId}/actions/${actionId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `seedMeetingWithAction` delegates to a different user, so the created
 * action starts `acceptance: "pending"` — `/complete` refuses a pending
 * action with 409, unrelated to this file's own tests. Accept it first via
 * the generic pending-decision endpoint, same as `meeting-actions.test.ts`.
 */
function acceptAction(app: App, actionId: string, workspaceId: string) {
  return app.request(
    `/api/pending-decision/meeting-action/${actionId}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, decision: "accepted", reason: null }),
    },
  );
}

/**
 * A General Management page holder who is deliberately NOT an attendee of
 * the meeting under test — the caller that distinguishes `canReadMeeting`
 * from `canPostActionUpdate`. Holding the page satisfies
 * `canPostActionUpdate` unconditionally, so this fixture only stays locked
 * out of a confidential meeting if `assertCanReadMeeting` is actually
 * composed in the route — unlike a plain stranger, who fails
 * `canPostActionUpdate` regardless and so proves nothing about
 * confidentiality.
 */
async function seedGmOfficerNotAttendee(workspaceId: string) {
  const gmOfficer = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: gmOfficer.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantGeneralManagement(workspaceId, gmOfficer.user.id);
  return gmOfficer;
}

/**
 * Owner creates a meeting and, as its creator, may delegate an action to
 * `assignee` without holding a separate General Management grant.
 */
async function seedMeetingWithAction(options?: {
  confidential?: boolean;
  assigneeIsAttendee?: boolean;
  status?: "draft" | "adopted";
}) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const assignee = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: owner.workspace.id,
    userId: assignee.user.id,
    role: "member",
    joinedAt: new Date(),
  });

  mockAuthenticatedSession(owner.user);
  const { app: ownerApp } = createApp();

  const created = await createMeeting(ownerApp, {
    workspaceId: owner.workspace.id,
    title: "Q3 Committee Meeting",
    confidential: options?.confidential ?? false,
  });
  const meeting = await created.json();

  if (options?.assigneeIsAttendee) {
    await addAttendee(
      ownerApp,
      meeting.id,
      owner.workspace.id,
      assignee.user.id,
    );
  }

  const actionRes = await createAction(ownerApp, meeting.id, {
    workspaceId: owner.workspace.id,
    description: "Draft the audit response",
    assigneeId: assignee.user.id,
  });
  const action = actionRes.ok ? await actionRes.json() : null;

  if (options?.status === "adopted") {
    // Adopt requires a second meeting to adopt into.
    const other = await createMeeting(ownerApp, {
      workspaceId: owner.workspace.id,
      title: "Later Meeting",
    });
    const otherMeeting = await other.json();
    const adopted = await ownerApp.request(`/api/meeting/${meeting.id}/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        adoptedByMeetingId: otherMeeting.id,
      }),
    });
    expect(adopted.status).toBe(200);
  }

  return { owner, assignee, meeting, action, ownerApp };
}

describe("API integration: meeting action updates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("1. the assignee posts with statusAfter 'done'; the update records its author and the action's status becomes done", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const res = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Draft sent for review",
      statusAfter: "done",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.authorId).toBe(assignee.user.id);
    expect(created.body).toBe("Draft sent for review");
    expect(created.statusAfter).toBe("done");

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.status).toBe("done");
    // Posting an update is not the formal completion act.
    expect(row.completedAt).toBeNull();
    expect(row.completedBy).toBeNull();
  });

  it("2. a page holder who is not the assignee may post; an unrelated workspace member may not, and no row is written", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    const gmOfficer = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: gmOfficer.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(owner.workspace.id, gmOfficer.user.id);

    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const gmRes = await postUpdate(gmApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Chasing this up on your behalf",
    });
    expect(gmRes.status).toBe(201);

    const stranger = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: stranger.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(stranger.user);
    const { app: strangerApp } = createApp();
    const strangerRes = await postUpdate(strangerApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "I'll just chip in here",
    });
    expect(strangerRes.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.meetingActionUpdateTable)
      .where(eq(schema.meetingActionUpdateTable.actionId, action.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authorId).toBe(gmOfficer.user.id);
    void assignee;
  });

  it("3. a comment-only update (statusAfter omitted) leaves the action's status untouched", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const res = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Still working on it",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.statusAfter).toBeNull();

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.status).toBe("open");
  });

  it("4. no route can edit or delete an update: PUT/PATCH/DELETE on the update path are 404", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "First update",
    });
    expect(posted.status).toBe(201);
    const created = await posted.json();

    const path = `/api/meeting/${meeting.id}/actions/${action.id}/updates/${created.id}`;
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const res = await assigneeApp.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    }

    const rows = await db
      .select()
      .from(schema.meetingActionUpdateTable)
      .where(eq(schema.meetingActionUpdateTable.actionId, action.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("First update");
  });

  it("5. a caller who cannot read a confidential meeting gets 403 and the meeting's title appears nowhere in the response body", async () => {
    // The assignee must be an attendee here, or assigning the action itself
    // would be refused (see meeting-actions.test.ts #8) and there would be
    // no action to exercise.
    //
    // The caller here MUST hold the General Management page (not be a plain
    // stranger): a plain stranger already fails `canPostActionUpdate` on its
    // own, so a test built on one passes identically whether or not
    // `assertCanReadMeeting` is even called — it would not have caught this
    // module's repeated history of leaking a confidential meeting's title.
    // A page holder who is not an attendee is blocked ONLY by
    // `assertCanReadMeeting`, so this exercises the actual check.
    const { owner, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });
    const gmOfficer = await seedGmOfficerNotAttendee(owner.workspace.id);

    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const res = await postUpdate(gmApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Trying to peek",
    });
    expect(res.status).toBe(403);
    const raw = await res.text();
    expect(raw).not.toContain("Q3 Committee Meeting");
  });

  it("5b. the same page-holding, non-attendee caller is refused on GET too, with no title leak", async () => {
    const { owner, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });
    const gmOfficer = await seedGmOfficerNotAttendee(owner.workspace.id);

    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const res = await listUpdates(
      gmApp,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    expect(res.status).toBe(403);
    const raw = await res.text();
    expect(raw).not.toContain("Q3 Committee Meeting");
  });

  it("5c. GET is a narrower surface than the meeting: a plain workspace member with no GM page and no assignment is refused, even on a non-confidential meeting", async () => {
    const { owner, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    const bystander = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: bystander.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(bystander.user);
    const { app: bystanderApp } = createApp();
    const res = await listUpdates(
      bystanderApp,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    expect(res.status).toBe(403);
  });

  it("6. posting on an adopted meeting's action succeeds", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
      status: "adopted",
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const res = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Still following up after adoption",
    });
    expect(res.status).toBe(201);
  });

  it("7. an invalid statusAfter is rejected", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const res = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Nice try",
      statusAfter: "in-progress-ish",
    });
    expect(res.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.status).toBe("open");
  });

  it("8. GET returns the thread oldest first", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "First",
    });
    await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Second",
      statusAfter: "done",
    });

    const res = await listUpdates(
      assigneeApp,
      meeting.id,
      action.id,
      owner.workspace.id,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((u: { body: string }) => u.body)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("9. an action whose thread set statusAfter 'done' can still be completed through /complete, setting completedAt/completedBy", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();

    // The thread moving `status` to "done" must not deadlock the formal
    // completion act — the bug this guards against had the /complete guard
    // keyed on `status = 'open'`, which this update would have permanently
    // broken.
    // seedMeetingWithAction delegates to a different user, so this action
    // starts pending and must be accepted before /complete will consider it.
    const accepted = await acceptAction(
      assigneeApp,
      action.id,
      owner.workspace.id,
    );
    expect(accepted.status).toBe(200);

    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Draft sent for review",
      statusAfter: "done",
    });
    expect(posted.status).toBe(201);

    const completed = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completedBody.status).toBe("done");
    expect(completedBody.completedBy).toBe(assignee.user.id);
    expect(completedBody.completedAt).not.toBeNull();
  });

  it("10. a second concurrent completion still claims no rows and reports 'Action already completed'", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const accepted = await acceptAction(
      assigneeApp,
      action.id,
      owner.workspace.id,
    );
    expect(accepted.status).toBe(200);

    const first = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(first.status).toBe(200);

    const second = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(second.status).toBe(409);
    // HTTPException here carries a plain-text body, not JSON — same as
    // every other 409 this route throws (see meeting-actions.test.ts, which
    // never calls .json() on one).
    const secondBody = await second.text();
    expect(secondBody).toBe("Action already completed");
  });

  it("11. a cancelled action still cannot be completed", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const accepted = await acceptAction(
      assigneeApp,
      action.id,
      owner.workspace.id,
    );
    expect(accepted.status).toBe(200);

    const cancelled = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "No longer needed",
      statusAfter: "cancelled",
    });
    expect(cancelled.status).toBe(201);

    const attempt = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(attempt.status).toBe(409);
    const attemptBody = await attempt.text();
    expect(attemptBody).toBe("This action was cancelled");
  });

  it("12. posting statusAfter 'open' on an already-completed action leaves completedAt/completedBy set (honest history, not an undo)", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const accepted = await acceptAction(
      assigneeApp,
      action.id,
      owner.workspace.id,
    );
    expect(accepted.status).toBe(200);

    const completed = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(completed.status).toBe(200);

    const reopened = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Actually, reopening this for discussion",
      statusAfter: "open",
    });
    expect(reopened.status).toBe(201);

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.status).toBe("open");
    // The thread never erases the record of a formal completion that
    // already happened — that would let discussion silently undo a formal
    // act. Only `/complete`'s own guard governs `completedAt`.
    expect(row.completedAt).not.toBeNull();
    expect(row.completedBy).toBe(assignee.user.id);
  });

  it("13. a non-PDF is refused at presign as well as finalize, separately", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const updateRes = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Attaching a report",
    });
    expect(updateRes.status).toBe(201);
    const createdUpdate = await updateRes.json();

    const presignRes = await presignAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      mimeType: "image/png",
      actionUpdateId: createdUpdate.id,
    });
    expect(presignRes.status).toBe(400);

    const finalizeRes = await finalizeAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      mimeType: "image/png",
      objectKey: `workspace/${owner.workspace.id}/meeting/${meeting.id}/report.png`,
      actionUpdateId: createdUpdate.id,
    });
    expect(finalizeRes.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.meetingId, meeting.id));
    expect(rows).toHaveLength(0);
  });

  it("14. finalizing with an actionUpdateId belonging to an update on a different meeting is 404", async () => {
    // The two seeds have separate workspaces (each `seedMeetingWithAction`
    // creates its own owner/workspace): post the update for meeting B using
    // B's own assignee and workspace.
    const seededA = await seedMeetingWithAction({ assigneeIsAttendee: true });
    const seededB = await seedMeetingWithAction({ assigneeIsAttendee: true });

    // `mockAuthenticatedSession` mocks a shared module-level session
    // resolved at request time, not at `createApp()` time — so the session
    // must be (re-)set immediately before each `.request()` call, not once
    // up front for both apps.
    mockAuthenticatedSession(seededB.assignee.user);
    const { app: assigneeAppB } = createApp();
    const updateBRes = await postUpdate(
      assigneeAppB,
      seededB.meeting.id,
      seededB.action.id,
      {
        workspaceId: seededB.owner.workspace.id,
        body: "Update on a different meeting entirely",
      },
    );
    expect(updateBRes.status).toBe(201);
    const updateB = await updateBRes.json();

    mockAuthenticatedSession(seededA.assignee.user);
    const { app: assigneeAppA } = createApp();
    const finalizeRes = await finalizeAttachment(
      assigneeAppA,
      seededA.meeting.id,
      {
        workspaceId: seededA.owner.workspace.id,
        objectKey: `workspace/${seededA.owner.workspace.id}/meeting/${seededA.meeting.id}/report.pdf`,
        actionUpdateId: updateB.id,
      },
    );
    expect(finalizeRes.status).toBe(404);
  });

  it("15. a non-attendee GM page holder cannot attach to a confidential meeting's action; the title leaks nowhere; the attendee assignee can", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });
    const gmOfficer = await seedGmOfficerNotAttendee(owner.workspace.id);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Attaching supporting evidence",
    });
    expect(posted.status).toBe(201);
    const update = await posted.json();

    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const gmPresign = await presignAttachment(gmApp, meeting.id, {
      workspaceId: owner.workspace.id,
      actionUpdateId: update.id,
    });
    expect(gmPresign.status).toBe(403);
    const gmRaw = await gmPresign.text();
    expect(gmRaw).not.toContain("Q3 Committee Meeting");

    // The session mock is global and resolved at request time — re-set it
    // to the assignee before this request, or it would still resolve as
    // the GM officer mocked just above, even though `assigneeApp` is a
    // different app instance.
    mockAuthenticatedSession(assignee.user);
    const assigneePresign = await presignAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      actionUpdateId: update.id,
    });
    expect(assigneePresign.status).toBe(200);
    const presigned = await assigneePresign.json();
    expect(typeof presigned.key).toBe("string");
  });

  it("16. a finalized row carries a not-null meetingId even when actionUpdateId is set", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Attaching the signed report",
    });
    expect(posted.status).toBe(201);
    const update = await posted.json();

    const presigned = await (
      await presignAttachment(assigneeApp, meeting.id, {
        workspaceId: owner.workspace.id,
        actionUpdateId: update.id,
      })
    ).json();

    const finalizeRes = await finalizeAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      objectKey: presigned.key,
      actionUpdateId: update.id,
    });
    expect(finalizeRes.status).toBe(201);
    const created = await finalizeRes.json();
    expect(created.meetingId).toBe(meeting.id);
    expect(created.actionUpdateId).toBe(update.id);

    const [row] = await db
      .select()
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.id, created.id));
    expect(row?.meetingId).toBe(meeting.id);
  });

  it("17. finalize refuses an object key outside this meeting's owner segment", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Attaching a report",
    });
    expect(posted.status).toBe(201);
    const update = await posted.json();

    // Creating a meeting requires the General Management page, which the
    // assignee (a plain member) does not hold — do this as the owner
    // instead, re-mocking the session for the same reason noted in test 15.
    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const otherMeeting = await createMeeting(ownerApp, {
      workspaceId: owner.workspace.id,
      title: "Some Other Meeting",
    });
    const other = await otherMeeting.json();

    mockAuthenticatedSession(assignee.user);
    const finalizeRes = await finalizeAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      objectKey: `workspace/${owner.workspace.id}/meeting/${other.id}/report.pdf`,
      actionUpdateId: update.id,
    });
    expect(finalizeRes.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.meetingId, meeting.id));
    expect(rows).toHaveLength(0);
  });

  it("18. download is refused for someone who cannot read the meeting", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const posted = await postUpdate(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Attaching a report",
    });
    expect(posted.status).toBe(201);
    const update = await posted.json();

    const presigned = await (
      await presignAttachment(assigneeApp, meeting.id, {
        workspaceId: owner.workspace.id,
        actionUpdateId: update.id,
      })
    ).json();
    const finalizeRes = await finalizeAttachment(assigneeApp, meeting.id, {
      workspaceId: owner.workspace.id,
      objectKey: presigned.key,
      actionUpdateId: update.id,
    });
    expect(finalizeRes.status).toBe(201);
    const doc = await finalizeRes.json();

    const gmOfficer = await seedGmOfficerNotAttendee(owner.workspace.id);
    mockAuthenticatedSession(gmOfficer.user);
    const { app: gmApp } = createApp();
    const refused = await downloadAttachment(
      gmApp,
      meeting.id,
      doc.id,
      owner.workspace.id,
    );
    expect(refused.status).toBe(403);
    const raw = await refused.text();
    expect(raw).not.toContain("Q3 Committee Meeting");
  });
});
