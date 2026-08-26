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

function decideAction(
  app: App,
  actionId: string,
  body: {
    workspaceId: string;
    decision: "accepted" | "rejected";
    reason: string | null;
  },
) {
  return app.request(
    `/api/pending-decision/meeting-action/${actionId}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function listPendingDecisions(app: App, workspaceId: string) {
  return app.request(`/api/pending-decision?workspaceId=${workspaceId}`);
}

/**
 * Owner creates a meeting and, as its creator, may delegate an action to
 * `assignee` without holding a separate General Management grant.
 */
async function seedMeetingWithAction(options?: {
  confidential?: boolean;
  assigneeIsAttendee?: boolean;
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
    await app_addAttendee(
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
  // A refusal (e.g. assigning on a confidential meeting to a non-reader) is
  // a plain-text HTTPException body, not JSON — only parse on success so
  // callers exercising the refusal path can still inspect actionRes itself.
  const action = actionRes.ok ? await actionRes.json() : null;

  return { owner, assignee, meeting, action, actionRes, ownerApp };
}

function app_addAttendee(
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

describe("API integration: meeting actions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("1. an action assigned to another user is pending and appears in their pending-decision list", async () => {
    const { owner, assignee, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });
    expect(action.acceptance).toBe("pending");
    expect(action.assigneeId).toBe(assignee.user.id);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const list = await listPendingDecisions(assigneeApp, owner.workspace.id);
    expect(list.status).toBe(200);
    const body = await list.json();
    const item = body.items.find(
      (i: { source: string }) => i.source === "meeting-action",
    );
    expect(item).toBeDefined();
    expect(item.id).toBe(action.id);
    expect(item.title).toBe("Q3 Committee Meeting");
    expect(item.requiresReason).toBe(true);
    expect(item.href).toBe("/dashboard/category/general-management");
  });

  it("2. accepting keeps the assignee and sets accepted", async () => {
    const { owner, assignee, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const decided = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "accepted",
      reason: null,
    });
    expect(decided.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.acceptance).toBe("accepted");
    expect(row.assigneeId).toBe(assignee.user.id);
  });

  it("3. rejecting with a reason clears the assignee, stores the reason, notifies fromUserId, and leaves the action on the meeting's record", async () => {
    const { owner, assignee, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const decided = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "rejected",
      reason: "Not my area of responsibility",
    });
    expect(decided.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row).toBeDefined();
    expect(row.acceptance).toBe("rejected");
    expect(row.assigneeId).toBeNull();
    expect(row.rejectionReason).toBe("Not my area of responsibility");
    // Nothing is deleted — the action stays on the meeting's historical record.
    expect(row.meetingId).toBe(action.meetingId);

    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, owner.user.id));
    const rejection = notifications.find(
      (n) => n.type === "meeting_action_rejected",
    );
    expect(rejection).toBeDefined();
    expect(rejection?.content).toBe("Not my area of responsibility");
    expect(rejection?.resourceType).toBe("meeting");
  });

  it("4. rejecting with an empty reason is 400 and changes nothing", async () => {
    const { owner, assignee, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const decided = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "rejected",
      reason: "   ",
    });
    expect(decided.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.id, action.id));
    expect(row.acceptance).toBe("pending");
    expect(row.assigneeId).toBe(assignee.user.id);
  });

  it("5. a second decision is 409", async () => {
    const { owner, assignee, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const first = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "accepted",
      reason: null,
    });
    expect(first.status).toBe(200);

    const second = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "accepted",
      reason: null,
    });
    expect(second.status).toBe(409);
  });

  it("6. a pending action cannot be completed (409); an accepted one can", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();

    const tooSoon = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(tooSoon.status).toBe(409);

    const accept = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "accepted",
      reason: null,
    });
    expect(accept.status).toBe(200);

    const completed = await completeAction(assigneeApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completedBody.status).toBe("done");
    expect(completedBody.completedBy).toBe(assignee.user.id);
  });

  it("7. an action on a confidential meeting does not appear in a non-attendee's pending list, and its meeting title appears nowhere in that response", async () => {
    const { owner, assignee } = await seedMeetingWithAction({
      confidential: true,
      // Deliberately NOT an attendee: the assignee here stands in for a
      // caller who was delegated an action but cannot read the meeting
      // itself — the exact leak this test guards against.
      assigneeIsAttendee: false,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const list = await listPendingDecisions(assigneeApp, owner.workspace.id);
    expect(list.status).toBe(200);
    const raw = await list.text();

    expect(raw).not.toContain("Q3 Committee Meeting");
    const body = JSON.parse(raw);
    const item = body.items.find(
      (i: { source: string }) => i.source === "meeting-action",
    );
    expect(item).toBeUndefined();
  });

  it("8. assigning an action on a confidential meeting to a non-attendee is refused at creation: 403, no action row, no notification row", async () => {
    const { owner, assignee, actionRes } = await seedMeetingWithAction({
      confidential: true,
      // Deliberately NOT an attendee — this is the exact case the whole-branch
      // review flagged: a confidential meeting's title must never leak
      // through a notification to someone who cannot read the meeting, and
      // gating only the notification would leave an undecidable action row
      // behind. The fix must refuse the assignment itself, before any write.
      assigneeIsAttendee: false,
    });

    expect(actionRes.status).toBe(403);

    const actionRows = await db
      .select()
      .from(schema.meetingActionTable)
      .where(eq(schema.meetingActionTable.fromUserId, owner.user.id));
    expect(actionRows).toHaveLength(0);

    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, assignee.user.id));
    expect(notifications).toHaveLength(0);
  });

  it("9. a General Management page holder who is not an attendee is refused completing an action on a confidential meeting (403); the assignee themself is unaffected", async () => {
    const { owner, assignee, meeting, action } = await seedMeetingWithAction({
      confidential: true,
      assigneeIsAttendee: true,
    });

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const accept = await decideAction(assigneeApp, action.id, {
      workspaceId: owner.workspace.id,
      decision: "accepted",
      reason: null,
    });
    expect(accept.status).toBe(200);

    // A GM page holder who was never an attendee of this confidential
    // meeting must not be able to read it — and completing this action
    // would let them read who did what and why, so it stays gated too.
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
    const officerAttempt = await completeAction(gmApp, meeting.id, action.id, {
      workspaceId: owner.workspace.id,
    });
    expect(officerAttempt.status).toBe(403);

    // The assignee's own branch is unaffected by the gate above.
    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp2 } = createApp();
    const assigneeComplete = await completeAction(
      assigneeApp2,
      meeting.id,
      action.id,
      { workspaceId: owner.workspace.id },
    );
    expect(assigneeComplete.status).toBe(200);
  });
});
