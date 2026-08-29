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

function createAction(
  app: App,
  meetingId: string,
  body: { workspaceId: string; description: string; assigneeId?: string },
) {
  return app.request(`/api/meeting/${meetingId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

  it("2. rows marked / become actions, each linked to its own item via minuteItemId; assigneeId is null, acceptance is accepted (matching POST /:id/actions' own-unassigned convention), and it appears in nobody's pending decisions", async () => {
    const { owner, app, meeting } = await seedMeeting();

    // A second General Management officer. Used as a POSITIVE CONTROL: a
    // normal action delegated to them must show up in THEIR pending-decision
    // list, so that the later assertion "the imported action does not
    // appear" demonstrates the provider actually distinguishes assigned from
    // unassigned rather than the whole endpoint being silently broken (e.g.
    // unregistered, or `source` misspelled) or the owner simply never
    // being eligible to see meeting-action items in the first place.
    const officer = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: officer.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantGeneralManagement(owner.workspace.id, officer.user.id);

    const assignedRes = await createAction(app, meeting.id, {
      workspaceId: owner.workspace.id,
      description: "A normal, explicitly-delegated action",
      assigneeId: officer.user.id,
    });
    expect(assignedRes.status).toBe(201);

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
    const imported = actions.filter((a) => a.minuteItemId !== null);
    expect(imported).toHaveLength(2);
    for (const action of imported) {
      expect(action.assigneeId).toBeNull();
      // Pinning the convention: `POST /:id/actions` treats "no assignee" as
      // "accepted", not "pending" — an unassigned imported action must match,
      // or it becomes undecidable, uncompletable, and un-delegable (see the
      // route-level comment).
      expect(action.acceptance).toBe("accepted");
    }
    const linkedItemIds = imported.map((a) => a.minuteItemId).sort();
    expect(linkedItemIds).toEqual([budgetItem?.id, aobItem?.id].sort());

    // Positive control: the officer's own delegated action DOES appear in
    // their pending-decision list.
    mockAuthenticatedSession(officer.user);
    const { app: officerApp } = createApp();
    const officerList = await listPendingDecisions(
      officerApp,
      owner.workspace.id,
    );
    expect(officerList.status).toBe(200);
    const officerBody = await officerList.json();
    const officerActionItems = officerBody.items.filter(
      (i: { source: string }) => i.source === "meeting-action",
    );
    expect(officerActionItems).toHaveLength(1);

    // An unassigned imported action reaches nobody's pending-decision list —
    // not the owner, not the officer (checked above; only their own
    // delegated action appeared), not anyone else in the workspace.
    // `mockAuthenticatedSession` replaces a single global spy rather than
    // binding per-app, so the session must be switched back to the owner
    // explicitly before reusing `app` — otherwise this request would still
    // run as the officer from the check just above.
    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const list = await listPendingDecisions(ownerApp, owner.workspace.id);
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

  it("4b. an existing numbering with surrounding whitespace still collides with the trimmed incoming value", async () => {
    const { owner, app, meeting } = await seedMeeting();

    // Seeded with padding spaces deliberately: a naive `filter(Boolean)` on
    // the existing side (instead of trim-then-filter) would treat " 1 " as
    // distinct from "1" and let this import through — the exact bug the
    // `.trim()` on the existing side exists to prevent. `numbering: ""` would
    // NOT exercise this: `clean()` turns a blank incoming value to `null`
    // before the `taken` set is even consulted (see 4c below), so this test
    // needs a non-blank value to actually reach the `.trim()` comparison.
    await db.insert(schema.meetingMinuteItemTable).values({
      meetingId: meeting.id,
      position: 0,
      topic: "Pre-existing item with padded numbering",
      numbering: " 1 ",
    });

    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(
      body.errors.some((e: { message: string }) => e.message.includes("1")),
    ).toBe(true);

    const items = await itemsFor(meeting.id);
    // Only the pre-existing seeded row — the import wrote nothing.
    expect(items).toHaveLength(1);
  });

  it("4c. blank numbering on both the incoming rows and existing items never collides with itself", async () => {
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

  it("4d. errors are returned sorted by row, even though the numbering conflict is appended after validateImportRows' own row-validation errors", async () => {
    const { owner, app, meeting } = await seedMeeting();

    const seeded = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [{ numbering: "1", topic: "Opening remarks" }],
    });
    expect(seeded.status).toBe(201);

    // Row 2 (index 0) collides with the existing numbering "1" — a conflict
    // error, appended by the route AFTER validateImportRows returns. Row 5
    // (index 3) has a blank topic — a row-validation error, already in the
    // array validateImportRows produced. Unsorted, row 5 would print before
    // row 2 simply because of insertion order, which is the wrong order for
    // a human reading the file top to bottom.
    const res = await importItems(app, meeting.id, {
      workspaceId: owner.workspace.id,
      rows: [
        { numbering: "1", topic: "Duplicate numbering" },
        { numbering: "2", topic: "Fine" },
        { numbering: "3", topic: "Also fine" },
        { numbering: "4", topic: "" },
      ],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    const rows = body.errors.map((e: { row: number }) => e.row);
    expect(rows).toEqual([2, 5]);
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
