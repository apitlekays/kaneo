import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
  type SeededMemberContext,
} from "./helpers/fixtures";

/**
 * `pendingIndexCount` on the meetings list response: how many archival
 * documents are still awaiting text extraction.
 *
 * It exists because a `pending` document is INVISIBLE to search, so a result
 * set can be legitimately incomplete and the grid has to be able to say so.
 * Without it, a user whose scan has not finished indexing concludes search is
 * broken — the same failure class as this module's errored list once
 * rendering identically to an empty one.
 *
 * Documents are inserted directly rather than through presign/finalize: the
 * aggregate filters on `index_status` and `action_update_id`, so how a row
 * arrived is irrelevant, and going direct keeps this file free of S3 mocking
 * and of the indexing queue.
 */

type App = ReturnType<typeof createApp>["app"];

type ListResponse = {
  items: Array<{ id: string; title: string }>;
  nextCursor: string | null;
  pendingIndexCount: number;
};

function appFor(user: SeededMemberContext["user"]): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

async function seedMeeting(options: {
  workspaceId: string;
  title: string;
  confidential?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(schema.meetingTable)
    .values({
      workspaceId: options.workspaceId,
      title: options.title,
      confidential: options.confidential ?? false,
    })
    .returning();
  return row.id;
}

/**
 * A General Management page holder who is deliberately NOT an attendee. The
 * only thing between this caller and a confidential meeting is the
 * visibility predicate — a plain stranger would be refused by the page check
 * regardless and so would prove nothing about confidentiality.
 */
async function seedGmOfficer(
  workspaceId: string,
): Promise<SeededMemberContext> {
  const officer = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: officer.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantGeneralManagement(workspaceId, officer.user.id);
  return officer;
}

async function addDocument(options: {
  workspaceId: string;
  meetingId: string;
  indexStatus: "pending" | "indexed" | "failed";
  actionUpdateId?: string | null;
  name: string;
}): Promise<void> {
  await db.insert(schema.meetingDocumentTable).values({
    meetingId: options.meetingId,
    workspaceId: options.workspaceId,
    actionUpdateId: options.actionUpdateId ?? null,
    objectKey: `workspace/${options.workspaceId}/meeting/${options.meetingId}/${options.name}`,
    filename: `${options.name}.pdf`,
    mimeType: "application/pdf",
    size: 2048,
    kind: options.actionUpdateId ? "original" : "minutes",
    indexStatus: options.indexStatus,
  });
}

async function list(app: App, workspaceId: string): Promise<ListResponse> {
  const res = await app.request(
    `/api/meeting?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ListResponse;
}

describe("API integration: meetings list pendingIndexCount", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("is 0 when no document is awaiting indexing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const app = appFor(owner.user);
    const meetingId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "Quarterly Committee",
    });
    // A positive control: an INDEXED document must not be counted, so this
    // asserting 0 means the status filter works rather than that the query
    // found nothing at all.
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId,
      indexStatus: "indexed",
      name: "already-done",
    });

    const body = await list(app, owner.workspace.id);
    expect(body.items).toHaveLength(1);
    expect(body.pendingIndexCount).toBe(0);
  });

  it("counts an archival document that is still pending", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const app = appFor(owner.user);
    const meetingId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "AGM 2026",
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId,
      indexStatus: "pending",
      name: "scan-one",
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId,
      indexStatus: "pending",
      name: "scan-two",
    });

    const body = await list(app, owner.workspace.id);
    expect(body.pendingIndexCount).toBe(2);
  });

  it("does not count a failed index — it is not awaiting anything", async () => {
    // `failed` is terminal until someone retries it, so counting it would
    // make the "results may be incomplete" notice permanent and meaningless.
    const owner = await createWorkspaceMember({ role: "owner" });
    const app = appFor(owner.user);
    const meetingId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "EGM",
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId,
      indexStatus: "failed",
      name: "broken",
    });

    const body = await list(app, owner.workspace.id);
    expect(body.pendingIndexCount).toBe(0);
  });

  it("does not count reply attachments, which sit at pending forever", async () => {
    // Spec C's action-thread attachments are never indexed by design, so
    // they stay `pending` for the life of the row. Counting them would pin
    // the notice on permanently for every workspace that has ever attached a
    // PDF to an action.
    const owner = await createWorkspaceMember({ role: "owner" });
    const app = appFor(owner.user);
    const meetingId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "Committee",
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId,
      indexStatus: "pending",
      actionUpdateId: "some-update-id",
      name: "thread-attachment",
    });

    const body = await list(app, owner.workspace.id);
    expect(body.pendingIndexCount).toBe(0);
  });

  it("hides a confidential meeting's pending documents from a non-attendee", async () => {
    // The security property. A bare workspace-wide count would tell a
    // non-attendee that SOME confidential meeting is holding unindexed
    // documents — oblique, but this module has already leaked a confidential
    // meeting through three oblique paths.
    const owner = await createWorkspaceMember({ role: "owner" });
    const officer = await seedGmOfficer(owner.workspace.id);

    const confidentialId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "Disciplinary Panel",
      confidential: true,
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId: confidentialId,
      indexStatus: "pending",
      name: "sealed-scan",
    });

    // The officer holds the General Management page but is NOT an attendee.
    const officerBody = await list(appFor(officer.user), owner.workspace.id);
    expect(officerBody.pendingIndexCount).toBe(0);
    // Positive control: the same request DOES work for them, and the
    // confidential meeting is genuinely absent from their list — so the 0
    // above is the predicate doing its job, not a broken request.
    expect(officerBody.items.map((m) => m.title)).not.toContain(
      "Disciplinary Panel",
    );

    // And the owner, who may read it, does see the count.
    const ownerBody = await list(appFor(owner.user), owner.workspace.id);
    expect(ownerBody.pendingIndexCount).toBe(1);
  });

  it("counts a confidential meeting's pending documents for an attendee", async () => {
    // The other half of the predicate: attendance, not just page access, is
    // what grants it.
    const owner = await createWorkspaceMember({ role: "owner" });
    const officer = await seedGmOfficer(owner.workspace.id);

    const confidentialId = await seedMeeting({
      workspaceId: owner.workspace.id,
      title: "Audit Subcommittee",
      confidential: true,
    });
    await addDocument({
      workspaceId: owner.workspace.id,
      meetingId: confidentialId,
      indexStatus: "pending",
      name: "audit-scan",
    });

    await db.insert(schema.meetingAttendeeTable).values({
      meetingId: confidentialId,
      userId: officer.user.id,
    });

    const body = await list(appFor(officer.user), owner.workspace.id);
    expect(body.pendingIndexCount).toBe(1);
  });

  it("does not count another workspace's pending documents", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const otherMeetingId = await seedMeeting({
      workspaceId: other.workspace.id,
      title: "Someone Else's Meeting",
    });
    await addDocument({
      workspaceId: other.workspace.id,
      meetingId: otherMeetingId,
      indexStatus: "pending",
      name: "not-ours",
    });

    const body = await list(appFor(owner.user), owner.workspace.id);
    expect(body.pendingIndexCount).toBe(0);
  });
});
