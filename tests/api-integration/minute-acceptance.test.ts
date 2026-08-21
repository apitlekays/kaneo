import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function captureLetter(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  const response = await app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Ujian penerimaan tindakan",
    }),
  });
  return response.json();
}

function createMinute(
  app: ReturnType<typeof createApp>["app"],
  letterId: string,
  workspaceId: string,
  assigneeId?: string,
  body = "Sila semak dan sahkan peruntukan",
) {
  return app.request(`/api/correspondence/letters/${letterId}/minutes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, body, assigneeId }),
  });
}

function decideMinuteAction(
  app: ReturnType<typeof createApp>["app"],
  minuteId: string,
  workspaceId: string,
  decision: "accepted" | "rejected",
  reason: string | null = null,
) {
  return app.request(`/api/pending-decision/minute-action/${minuteId}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, decision, reason }),
  });
}

async function completeMinute(
  app: ReturnType<typeof createApp>["app"],
  letterId: string,
  minuteId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/correspondence/letters/${letterId}/minutes/${minuteId}/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    },
  );
}

async function fetchMinuteRow(minuteId: string) {
  const [row] = await db
    .select()
    .from(schema.letterMinuteTable)
    .where(eq(schema.letterMinuteTable.id, minuteId));
  return row;
}

/**
 * Officer (owner, bypasses page access) delegates an action on a fresh
 * letter to `assignee`, another workspace member. Returns the letter and
 * minute rows from the JSON responses.
 */
async function seedDelegatedAction(
  officer: Awaited<ReturnType<typeof createWorkspaceMember>>,
  assignee: Awaited<ReturnType<typeof createWorkspaceMember>>,
) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: officer.workspace.id,
    userId: assignee.user.id,
    role: "member",
    joinedAt: new Date(),
  });

  mockAuthenticatedSession(officer.user);
  const { app } = createApp();
  const letter = await captureLetter(app, officer.workspace.id);
  const minuteResponse = await createMinute(
    app,
    letter.id,
    officer.workspace.id,
    assignee.user.id,
  );
  const minute = await minuteResponse.json();
  return { letter, minute };
}

describe("API integration: minute action acceptance", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("leaves a delegated action pending and lists it in the assignee's pending-decision queue", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { minute } = await seedDelegatedAction(officer, assignee);

    expect(minute.acceptance).toBe("pending");
    expect(minute.assigneeId).toBe(assignee.user.id);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await assigneeApp.request(
      `/api/pending-decision?workspaceId=${officer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const item = body.items.find(
      (i: { source: string; id: string }) =>
        i.source === "minute-action" && i.id === minute.id,
    );
    expect(item).toBeDefined();
  });

  it("auto-accepts self-delegation and produces no pending item", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const letter = await captureLetter(app, officer.workspace.id);
    const minuteResponse = await createMinute(
      app,
      letter.id,
      officer.workspace.id,
      officer.user.id,
    );
    const minute = await minuteResponse.json();
    expect(minute.acceptance).toBe("accepted");

    const response = await app.request(
      `/api/pending-decision?workspaceId=${officer.workspace.id}`,
    );
    const body = await response.json();
    const item = body.items.find(
      (i: { source: string; id: string }) =>
        i.source === "minute-action" && i.id === minute.id,
    );
    expect(item).toBeUndefined();
  });

  it("accepting keeps the assignee and sets acceptance to accepted", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "accepted",
    );
    expect(response.status).toBe(200);

    const row = await fetchMinuteRow(minute.id);
    expect(row.acceptance).toBe("accepted");
    expect(row.assigneeId).toBe(assignee.user.id);
  });

  it("rejecting with a reason clears the assignee, sets rejected, stores the reason, and keeps the minute in the letter's history", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "rejected",
      "Bukan bidang saya",
    );
    expect(response.status).toBe(200);

    const row = await fetchMinuteRow(minute.id);
    expect(row.acceptance).toBe("rejected");
    expect(row.assigneeId).toBeNull();
    expect(row.rejectionReason).toBe("Bukan bidang saya");

    // The minute is never deleted — it stays as part of the letter's record.
    const remaining = await db
      .select()
      .from(schema.letterMinuteTable)
      .where(eq(schema.letterMinuteTable.letterId, letter.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(minute.id);

    // The delegator is notified that their action bounced back.
    const [notification] = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, officer.user.id),
          eq(schema.notificationTable.type, "letter_action_rejected"),
        ),
      );
    expect(notification).toBeDefined();
    expect(notification.content).toBe("Bukan bidang saya");
  });

  it("refuses a rejection with an empty or whitespace-only reason, and changes nothing", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "rejected",
      "   ",
    );
    expect(response.status).toBe(400);

    const row = await fetchMinuteRow(minute.id);
    expect(row.acceptance).toBe("pending");
    expect(row.assigneeId).toBe(assignee.user.id);
    expect(row.rejectionReason).toBeNull();
  });

  it("does not count a pending action toward the letter's actionsTotal", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    // A second, self-delegated action on the same letter — auto-accepted —
    // so the count can distinguish "accepted work exists" from "nothing
    // counts at all".
    await createMinute(
      app,
      letter.id,
      officer.workspace.id,
      officer.user.id,
      "Tindakan sendiri",
    );

    const response = await app.request(
      `/api/correspondence/letters?workspaceId=${officer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const rows = await response.json();
    const row = rows.find((r: { id: string }) => r.id === letter.id);
    expect(row).toBeDefined();
    // Only the accepted (self-delegated) minute counts; the pending one
    // delegated to `assignee` must not inflate the total.
    expect(row.actionsTotal).toBe(1);
    expect(row.actionsDone).toBe(0);
  });

  it("returns 409 on a second decision for the same action", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const first = await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "accepted",
    );
    expect(first.status).toBe(200);

    const second = await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "rejected",
      "Terlalu lewat",
    );
    expect(second.status).toBe(409);

    // The first decision stands; the second attempt changed nothing.
    const row = await fetchMinuteRow(minute.id);
    expect(row.acceptance).toBe("accepted");
    expect(row.assigneeId).toBe(assignee.user.id);
  });

  it("keeps a pending action out of the assignee's my-correspondence work list until it is accepted", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const beforeAccept = await (
      await assigneeApp.request(
        `/api/correspondence/my-correspondence?workspaceId=${officer.workspace.id}`,
      )
    ).json();
    expect(
      beforeAccept.actions.some((a: { id: string }) => a.id === minute.id),
    ).toBe(false);

    await decideMinuteAction(
      assigneeApp,
      minute.id,
      officer.workspace.id,
      "accepted",
    );

    const afterAccept = await (
      await assigneeApp.request(
        `/api/correspondence/my-correspondence?workspaceId=${officer.workspace.id}`,
      )
    ).json();
    expect(
      afterAccept.actions.some((a: { id: string }) => a.id === minute.id),
    ).toBe(true);
  });

  it("refuses to complete a delegated action that has not yet been accepted", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "member" });
    const { letter, minute } = await seedDelegatedAction(officer, assignee);

    mockAuthenticatedSession(assignee.user);
    const { app: assigneeApp } = createApp();
    const response = await completeMinute(
      assigneeApp,
      letter.id,
      minute.id,
      officer.workspace.id,
    );
    expect(response.status).toBe(409);

    const row = await fetchMinuteRow(minute.id);
    expect(row.status).toBe("open");
    expect(row.completedAt).toBeNull();
    expect(row.acceptance).toBe("pending");
  });
});
