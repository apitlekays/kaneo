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
    // no action to exercise. The stranger below is the one who must stay
    // locked out.
    const { owner, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });

    const stranger = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: stranger.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(stranger.user);
    const { app: strangerApp } = createApp();
    const res = await postUpdate(strangerApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
      body: "Trying to peek",
    });
    expect(res.status).toBe(403);
    const raw = await res.text();
    expect(raw).not.toContain("Q3 Committee Meeting");
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
});
