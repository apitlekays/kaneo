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
      subject: "Ujian keputusan tertunda",
      assigneeId,
    }),
  });
  return response;
}

/** Officer routes a captured letter to a GM-granted clerk, as in correspondence-handover.test.ts. */
async function seedRoutedLetter() {
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

  return { officer, clerk, letter: created, assignment };
}

describe("API integration: pending decisions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists a routed letter for its recipient", async () => {
    const { officer, clerk, letter, assignment } = await seedRoutedLetter();

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();
    const response = await clerkApp.request(
      `/api/pending-decision?workspaceId=${officer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.failedSources).toEqual([]);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.source).toBe("correspondence");
    expect(item.id).toMatch(/^[^:]+:[^:]+$/);
    expect(item.id).toBe(`${letter.id}:${assignment.id}`);
    expect(item.requiresReason).toBe(true);
  });

  it("accepts an item and clears it from the list, then 409s on a second decision", async () => {
    const { officer, clerk, letter, assignment } = await seedRoutedLetter();
    const itemId = `${letter.id}:${assignment.id}`;

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();

    const decided = await clerkApp.request(
      `/api/pending-decision/correspondence/${itemId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          decision: "accepted",
          reason: null,
        }),
      },
    );
    expect(decided.status).toBe(200);

    const followUp = await clerkApp.request(
      `/api/pending-decision?workspaceId=${officer.workspace.id}`,
    );
    const followUpBody = await followUp.json();
    expect(followUpBody.items).toHaveLength(0);

    const [row] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    expect(row.currentAssigneeId).toBe(clerk.user.id);

    const repeat = await clerkApp.request(
      `/api/pending-decision/correspondence/${itemId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          decision: "accepted",
          reason: null,
        }),
      },
    );
    expect(repeat.status).toBe(409);
  });

  it("rejects a null reason with 400 and leaves the assignment pending", async () => {
    const { officer, clerk, letter, assignment } = await seedRoutedLetter();
    const itemId = `${letter.id}:${assignment.id}`;

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();

    const response = await clerkApp.request(
      `/api/pending-decision/correspondence/${itemId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          decision: "rejected",
          reason: null,
        }),
      },
    );
    expect(response.status).toBe(400);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    expect(assignmentRow.status).toBe("pending");

    const [letterRow] = await db
      .select()
      .from(schema.letterTable)
      .where(eq(schema.letterTable.id, letter.id));
    expect(letterRow.currentAssigneeId).toBeNull();
  });

  it("rejects a whitespace-only reason with 400 and leaves the assignment pending", async () => {
    const { officer, clerk, letter, assignment } = await seedRoutedLetter();
    const itemId = `${letter.id}:${assignment.id}`;

    mockAuthenticatedSession(clerk.user);
    const { app: clerkApp } = createApp();

    const response = await clerkApp.request(
      `/api/pending-decision/correspondence/${itemId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: officer.workspace.id,
          decision: "rejected",
          reason: "   ",
        }),
      },
    );
    expect(response.status).toBe(400);

    const [assignmentRow] = await db
      .select()
      .from(schema.letterAssignmentTable)
      .where(eq(schema.letterAssignmentTable.id, assignment.id));
    expect(assignmentRow.status).toBe("pending");
  });
});
