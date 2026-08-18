import { and, eq } from "drizzle-orm";
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
});
