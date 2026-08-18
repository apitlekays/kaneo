import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

async function captureLetter(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  assigneeId?: string,
) {
  const response = await app.request("/api/correspondence/letters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Ujian serah tugas",
      assigneeId,
    }),
  });
  return response;
}

describe("API integration: bilateral handover", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("leaves a letter unowned until the assignee accepts", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    // Put the clerk in the officer's workspace.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const response = await captureLetter(
      app,
      officer.workspace.id,
      clerk.user.id,
    );
    expect(response.status).toBe(201);
    const letter = await response.json();

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    expect(row.currentAssigneeId).toBeNull();
    expect(row.status).toBe("captured");

    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, letter.id));
    expect(assignment.toUserId).toBe(clerk.user.id);
    expect(assignment.status).toBe("pending");
  });

  it("keeps the letter with the sender until the new assignee accepts", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();

    const created = await (
      await captureLetter(app, officer.workspace.id)
    ).json();

    // Give it an owner directly, standing in for an accepted first assignment.
    await db
      .update(schema.letterTable)
      .set({ currentAssigneeId: officer.user.id })
      .where(eq(schema.letterTable.id, created.id));

    const other = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: other.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const routed = await app.request(
      `/api/correspondence/letters/${created.id}/route`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          toUserId: other.user.id,
          action: "inspect",
        }),
      },
    );
    expect(routed.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(officer.user.id);
  });

  it("supersedes an open pending assignment when the letter is routed again", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const first = await createWorkspaceMember({ role: "member" });
    const second = await createWorkspaceMember({ role: "member" });
    for (const u of [first, second]) {
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: officer.workspace.id,
        userId: u.user.id,
        role: "member",
        joinedAt: new Date(),
      });
    }
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, first.user.id)
    ).json();

    await app.request(`/api/correspondence/letters/${created.id}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        toUserId: second.user.id,
      }),
    });

    const rows = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));
    const forFirst = rows.find((r) => r.toUserId === first.user.id);
    const forSecond = rows.find((r) => r.toUserId === second.user.id);
    expect(forFirst?.status).toBe("superseded");
    expect(forSecond?.status).toBe("pending");
  });

  it("transfers ownership when the recipient accepts", async () => {
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
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));
    // Registered letters advance to "assigned" on accept; an unregistered one
    // stays "captured" (covered separately below).
    await db
      .update(schema.letterTable)
      .set({ status: "registered", refNo: "KKM/2026/0001" })
      .where(eq(schema.letterTable.id, created.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const accepted = await clerkApp.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: officer.workspace.id }),
      },
    );
    expect(accepted.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(clerk.user.id);
    expect(row.status).toBe("assigned");
  });

  it("returns the letter to the sender when the recipient rejects", async () => {
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
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    await clerkApp.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          note: "Bukan bidang saya",
        }),
      },
    );

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(row.currentAssigneeId).toBe(officer.user.id);
  });

  it("refuses a decision from anyone but the named recipient", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    // The officer is the sender, not the recipient.
    const response = await app.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: officer.workspace.id }),
      },
    );
    expect(response.status).toBe(403);
  });

  it("refuses a decision on an assignment that belongs to a different workspace", async () => {
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
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    // A member of an unrelated workspace B, who happens to know the (letterId,
    // assignmentId) pair from workspace A, submits their OWN workspace id.
    const attacker = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();
    const response = await attackerApp.request(
      `/api/correspondence/letters/${created.id}/assignments/${assignment.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: attacker.workspace.id }),
      },
    );
    expect(response.status).toBe(404);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    expect(assignmentRow.status).toBe("pending");

    const [letterRow] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, created.id));
    expect(letterRow.currentAssigneeId).toBeNull();
  });

  it("lists a pending assignment for its recipient", async () => {
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
    const { app } = createApp();
    await captureLetter(app, officer.workspace.id, clerk.user.id);

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await clerkApp.request(
      `/api/correspondence/my-correspondence?workspaceId=${officer.workspace.id}`,
    );
    const body = await response.json();
    expect(body.pendingAssignments).toHaveLength(1);
    expect(body.pendingAssignments[0].subject).toBe("Ujian serah tugas");
  });

  it("lists pending assignments workspace-wide for the GM watchlist, including the note", async () => {
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
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id)
    ).json();
    // Route it to the clerk with a note, exercising the same field the
    // my-correspondence pendingAssignments query already carries.
    await app.request(`/api/correspondence/letters/${created.id}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        toUserId: clerk.user.id,
        action: "inspect",
        note: "Please expedite",
      }),
    });

    const response = await app.request(
      `/api/correspondence/letters/awaiting-acceptance?workspaceId=${officer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].subject).toBe("Ujian serah tugas");
    expect(body[0].toUserId).toBe(clerk.user.id);
    expect(body[0].note).toBe("Please expedite");
  });

  it("does not leak another workspace's pending assignments into the GM watchlist", async () => {
    const officerA = await createWorkspaceMember({ role: "owner" });
    const clerkA = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officerA.workspace.id,
      userId: clerkA.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(officerA.workspace.id, clerkA.user.id);

    mockAuthenticatedSession(officerA.user);
    const { app: appA } = createApp();
    await captureLetter(appA, officerA.workspace.id, clerkA.user.id);

    // A second, unrelated workspace with its own GM-granted owner and no
    // captured letters of its own.
    const officerB = await createWorkspaceMember({ role: "owner" });
    await grantGeneralManagement(officerB.workspace.id, officerB.user.id);

    mockAuthenticatedSession(officerB.user);
    const { app: appB } = createApp();
    const response = await appB.request(
      `/api/correspondence/letters/awaiting-acceptance?workspaceId=${officerB.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(0);
  });

  // ── Lifecycle guards on a decision (accept/reject must not rewrite history) ──

  /** Officer + GM-granted clerk in one workspace, with a letter routed to the clerk. */
  async function seedPendingHandover() {
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
    const { app } = createApp();
    const letter = await (
      await captureLetter(app, officer.workspace.id, clerk.user.id)
    ).json();
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, letter.id));
    return { officer, clerk, app, letter, assignment };
  }

  function decide(
    app: ReturnType<typeof createApp>["app"],
    letterId: string,
    assignmentId: string,
    decision: "accept" | "reject",
    body: object,
  ) {
    return app.request(
      `/api/correspondence/letters/${letterId}/assignments/${assignmentId}/${decision}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  async function latestAuditEvent(workspaceId: string, action: string) {
    const [event] = await db
      .select()
      .from(schema.gmAuditEventTable)
      .where(
        and(
          eq(schema.gmAuditEventTable.workspaceId, workspaceId),
          eq(schema.gmAuditEventTable.action, action),
        ),
      )
      .orderBy(desc(schema.gmAuditEventTable.seq))
      .limit(1);
    return event;
  }

  for (const status of ["closed", "archived", "disposed"]) {
    it(`refuses to accept an assignment on a ${status} letter`, async () => {
      const { officer, clerk, letter, assignment } =
        await seedPendingHandover();
      await db
        .update(schema.letterTable)
        .set({ status })
        .where(eq(schema.letterTable.id, letter.id));

      mockAuthenticatedSession(clerk.user);
      const { app: clerkApp } = createApp();
      const response = await decide(
        clerkApp,
        letter.id,
        assignment.id,
        "accept",
        { workspaceId: officer.workspace.id },
      );
      expect(response.status).toBe(409);

      const [row] = await db
        .select()
        .from(schema.letterTable)
        .where(eq(schema.letterTable.id, letter.id));
      expect(row.status).toBe(status);
      expect(row.currentAssigneeId).toBeNull();
      const [assignmentRow] = await db
        .select()
        .from(schema.letterAssignmentTable)
        .where(eq(schema.letterAssignmentTable.id, assignment.id));
      expect(assignmentRow.status).toBe("pending");
    });
  }

  it("refuses a decision on a letter under legal hold", async () => {
    const { officer, clerk, letter, assignment } = await seedPendingHandover();
    await db
      .update(schema.letterTable)
      .set({ legalHold: true })
      .where(eq(schema.letterTable.id, letter.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await decide(
      clerkApp,
      letter.id,
      assignment.id,
      "reject",
      { workspaceId: officer.workspace.id, note: "Bukan bidang saya" },
    );
    expect(response.status).toBe(409);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    expect(assignmentRow.status).toBe("pending");
  });

  it("keeps an unregistered letter at 'captured' when the recipient accepts", async () => {
    const { officer, clerk, letter, assignment } = await seedPendingHandover();

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await decide(
      clerkApp,
      letter.id,
      assignment.id,
      "accept",
      { workspaceId: officer.workspace.id },
    );
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    // Ownership transfers, but the letter still has no reference number, so it
    // must stay on the "pending registration" tile.
    expect(row.currentAssigneeId).toBe(clerk.user.id);
    expect(row.refNo).toBeNull();
    expect(row.status).toBe("captured");
  });

  it("records the before and after owner and status on the accept audit event", async () => {
    const { officer, clerk, letter, assignment } = await seedPendingHandover();

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    await decide(clerkApp, letter.id, assignment.id, "accept", {
      workspaceId: officer.workspace.id,
    });

    const event = await latestAuditEvent(officer.workspace.id, "accept");
    expect(event.before).toMatchObject({
      currentAssigneeId: null,
      status: "captured",
    });
    expect(event.after).toMatchObject({
      assignmentId: assignment.id,
      currentAssigneeId: clerk.user.id,
      status: "captured",
    });
  });

  it("keeps the sender's routing note and records the rejection reason in the audit trail", async () => {
    const officer = await createWorkspaceMember({ role: "owner" });
    const clerk = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: clerk.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    const created = await (
      await captureLetter(app, officer.workspace.id)
    ).json();
    await app.request(`/api/correspondence/letters/${created.id}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        toUserId: clerk.user.id,
        note: "Sila ambil tindakan segera",
      }),
    });
    const [assignment] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.letterId, created.id));

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await decide(
      clerkApp,
      created.id,
      assignment.id,
      "reject",
      { workspaceId: officer.workspace.id, note: "Bukan bidang saya" },
    );
    expect(response.status).toBe(200);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    expect(assignmentRow.status).toBe("rejected");
    // Both are record: the routing instruction stays on the row, the reason
    // lives in the append-only trail.
    expect(assignmentRow.note).toBe("Sila ambil tindakan segera");

    const event = await latestAuditEvent(officer.workspace.id, "reject");
    expect(event.after).toMatchObject({ reason: "Bukan bidang saya" });
  });

  it("lets only one of a concurrent accept and reject win", async () => {
    const { officer, clerk, letter, assignment } = await seedPendingHandover();

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const [accepted, rejected] = await Promise.all([
      decide(clerkApp, letter.id, assignment.id, "accept", {
        workspaceId: officer.workspace.id,
      }),
      decide(clerkApp, letter.id, assignment.id, "reject", {
        workspaceId: officer.workspace.id,
        note: "Bukan bidang saya",
      }),
    ]);
    const statuses = [accepted.status, rejected.status].sort();
    expect(statuses).toEqual([200, 409]);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    // The surviving decision and the letter's owner must agree.
    const expectedOwner =
      assignmentRow.status === "accepted" ? clerk.user.id : officer.user.id;
    expect(row.currentAssigneeId).toBe(expectedOwner);
  });

  it("records an audit event and notifies the bypassed recipient when routing supersedes", async () => {
    const { officer, letter, assignment } = await seedPendingHandover();
    const third = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: officer.workspace.id,
      userId: third.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(officer.user);
    const { app } = createApp();
    await app.request(`/api/correspondence/letters/${letter.id}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: officer.workspace.id,
        toUserId: third.user.id,
      }),
    });

    const event = await latestAuditEvent(officer.workspace.id, "supersede");
    expect(event).toBeDefined();
    expect(event.after).toMatchObject({ assignmentIds: [assignment.id] });
    expect(event.entityId).toBe(letter.id);
  });
});
