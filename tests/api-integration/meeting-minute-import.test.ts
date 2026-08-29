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

function addMinuteItem(
  app: App,
  meetingId: string,
  body: { workspaceId: string; topic: string; position?: number },
) {
  return app.request(`/api/meeting/${meetingId}/minute-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function importItems(
  app: App,
  meetingId: string,
  body: { workspaceId: string; rows: unknown[] },
) {
  return app.request(`/api/meeting/${meetingId}/minute-items/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listPendingDecisions(app: App, workspaceId: string) {
  return app.request(`/api/pending-decision?workspaceId=${workspaceId}`);
}

async function itemsFor(meetingId: string) {
  return db
    .select()
    .from(schema.meetingMinuteItemTable)
    .where(eq(schema.meetingMinuteItemTable.meetingId, meetingId))
    .orderBy(schema.meetingMinuteItemTable.position);
}

async function actionsFor(meetingId: string) {
  return db
    .select()
    .from(schema.meetingActionTable)
    .where(eq(schema.meetingActionTable.meetingId, meetingId));
}

/** Owner creates a non-confidential meeting; owner is a global admin. */
async function seedMeeting(confidential = false) {
  const owner = await createWorkspaceMember({ role: "owner" });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  const created = await createMeeting(app, {
    workspaceId: owner.workspace.id,
    title: "Q3 Committee Meeting",
    confidential,
  });
  const meeting = await created.json();
  return { owner, app, meeting };
}

describe("API integration: bulk-import minute items", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("1. imports every row in file order, continuing position after existing items", async () => {
    const { owner, app, meeting } = await seedMeeting();

    // Two pre-existing items at positions 0 and 1.
    await addMinuteItem(app, meeting.id, {
      workspaceId: owner.workspace.id,
      topic: "Call to order",
      position: 0,
    });
    await addMinuteItem(app, meeting.id, {
      workspaceId: owner.workspace.id,
      topic: "Apologies",
      position: 1,
    });

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "1", topic: "Opening remarks", details: "Chair opened" },
        { numbering: "2", topic: "Budget review" },
        { numbering: "3", topic: "AOB" },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.itemsCreated).toBe(3);
    expect(body.actionsCreated).toBe(0);

    const items = await itemsFor(meeting.id);
    expect(items).toHaveLength(5);
    const imported = items.filter((i) =>
      ["1", "2", "3"].includes(i.numbering ?? ""),
    );
    expect(imported.map((i) => i.topic)).toEqual([
      "Opening remarks",
      "Budget review",
      "AOB",
    ]);
    expect(imported.map((i) => i.position)).toEqual([2, 3, 4]);
  });

  it("2. rows marked / become actions, each linked to its own item via minuteItemId; assigneeId is null and it appears in nobody's pending decisions", async () => {
    const { owner, app, meeting } = await seedMeeting();

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "1", topic: "Opening remarks" },
        { numbering: "2", topic: "Budget review", action: "/" },
        { numbering: "3", topic: "AOB", action: "/" },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.itemsCreated).toBe(3);
    expect(body.actionsCreated).toBe(2);

    const items = await itemsFor(meeting.id);
    const budgetItem = items.find((i) => i.numbering === "2");
    const aobItem = items.find((i) => i.numbering === "3");
    expect(budgetItem).toBeDefined();
    expect(aobItem).toBeDefined();

    const actions = await actionsFor(meeting.id);
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action.assigneeId).toBeNull();
    }
    const linkedItemIds = actions.map((a) => a.minuteItemId).sort();
    expect(linkedItemIds).toEqual([budgetItem?.id, aobItem?.id].sort());

    // An unassigned action reaches nobody's pending-decision list — not the
    // owner, not anyone else in the workspace.
    const list = await listPendingDecisions(app, owner.workspace.id);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    const meetingActionItems = listBody.items.filter(
      (i: { source: string }) => i.source === "meeting-action",
    );
    expect(meetingActionItems).toHaveLength(0);
  });

  it("3. one invalid row rejects the whole import and writes nothing", async () => {
    const { owner, app, meeting } = await seedMeeting();

    const before = await itemsFor(meeting.id);
    expect(before).toHaveLength(0);

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "1", topic: "Opening remarks" },
        { numbering: "2", topic: "" }, // blank topic is invalid
        { numbering: "3", topic: "AOB" },
      ],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    const after = await itemsFor(meeting.id);
    expect(after).toHaveLength(0);
    const actions = await actionsFor(meeting.id);
    expect(actions).toHaveLength(0);
  });

  it("4. re-importing a file whose numbering already exists on the meeting is rejected, lists the conflicts, and writes nothing", async () => {
    const { owner, app, meeting } = await seedMeeting();

    const first = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(first.status).toBe(201);

    const second = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "1", topic: "Opening remarks, take two" },
        { numbering: "2", topic: "Budget review" },
      ],
    });
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(
      body.errors.some((e: { message: string }) => e.message.includes("1")),
    ).toBe(true);

    const items = await itemsFor(meeting.id);
    // Only the first import's single row, nothing from the second attempt.
    expect(items).toHaveLength(1);
  });

  it("4b. blank numbering on both the incoming rows and existing items never collides with itself", async () => {
    const { owner, app, meeting } = await seedMeeting();

    // Pre-existing item created via the single-item form, which stores ""
    // rather than NULL for an omitted numbering (b.numbering ?? null maps
    // only undefined) — so the DB already holds a blank-string numbering.
    await db.insert(schema.meetingMinuteItemTable).values({
      meetingId: meeting.id,
      position: 0,
      topic: "Pre-existing blank-numbered item",
      numbering: "",
    });

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "", topic: "First blank-numbered import row" },
        { numbering: "", topic: "Second blank-numbered import row" },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.itemsCreated).toBe(2);

    const items = await itemsFor(meeting.id);
    expect(items).toHaveLength(3);
  });

  it("5. import into an adopted meeting is 409", async () => {
    const { owner, app, meeting } = await seedMeeting();

    const otherMeetingRes = await createMeeting(app, {
      workspaceId: owner.workspace.id,
      title: "Later meeting that adopts this one",
    });
    const otherMeeting = await otherMeetingRes.json();

    const adopted = await app.request(`/api/meeting/${meeting.id}/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        adoptedByMeetingId: otherMeeting.id,
      }),
    });
    expect(adopted.status).toBe(200);

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(res.status).toBe(409);

    const items = await itemsFor(meeting.id);
    expect(items).toHaveLength(0);
  });

  it("6. a caller who cannot read a confidential meeting cannot import into it, and the meeting's title appears nowhere in the response", async () => {
    const { owner, meeting } = await seedMeeting(true);

    // A plain member, granted General Management (so it clears the page-access
    // middleware), but NOT an attendee of this confidential meeting and not a
    // global admin — the exact case `canReadMeeting` must refuse.
    const outsider = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: outsider.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(owner.workspace.id, outsider.user.id);

    mockAuthenticatedSession(outsider.user);
    const { app: outsiderApp } = createApp();
    const res = await importItems(outsiderApp, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(res.status).toBe(403);
    const raw = await res.text();
    expect(raw).not.toContain("Q3 Committee Meeting");

    const items = await itemsFor(meeting.id);
    expect(items).toHaveLength(0);
  });

  it("7. a caller without General Management access gets 403", async () => {
    const { owner, meeting } = await seedMeeting();

    const plainMember = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: plainMember.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    // Deliberately no grantGeneralManagement call.

    mockAuthenticatedSession(plainMember.user);
    const { app: memberApp } = createApp();
    const res = await importItems(memberApp, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(res.status).toBe(403);

    const items = await itemsFor(meeting.id);
    expect(items).toHaveLength(0);
  });
});
