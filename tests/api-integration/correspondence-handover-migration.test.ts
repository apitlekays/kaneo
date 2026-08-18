import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/drizzle/0053_accept_existing_assignments.sql",
);

/** Replay the data migration the way drizzle does: statement by statement. */
async function runMigration() {
  const statements = readFileSync(migrationPath, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function seedLetter(
  workspaceId: string,
  overrides: { status: string; currentAssigneeId?: string | null },
) {
  const [letter] = await db
    .insert(schema.letterTable)
    .values({
      workspaceId,
      direction: "in",
      type: "external",
      medium: "email",
      subject: "Warisan",
      status: overrides.status,
      currentAssigneeId: overrides.currentAssigneeId ?? null,
    })
    .returning();
  return letter;
}

async function seedPending(letterId: string, toUserId: string) {
  const [assignment] = await db
    .insert(schema.letterAssignmentTable)
    .values({ letterId, toUserId, status: "pending" })
    .returning();
  return assignment;
}

async function statusOf(assignmentId: string) {
  const [row] = await db
    .select()
    .from(schema.letterAssignmentTable)
    .where(eq(schema.letterAssignmentTable.id, assignmentId));
  return row;
}

describe("API integration: 0053 legacy assignment migration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("accepts the sitting owner's row and supersedes every earlier hop", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const bypassed = await createWorkspaceMember({ role: "member" });
    const letter = await seedLetter(owner.workspace.id, {
      status: "assigned",
      currentAssigneeId: owner.user.id,
    });
    // A multi-hop letter under the old code: every hop overwrote the letter's
    // assignee but left its own assignment row pending.
    const earlier = await seedPending(letter.id, bypassed.user.id);
    const current = await seedPending(letter.id, owner.user.id);

    await runMigration();

    expect((await statusOf(current.id)).status).toBe("accepted");
    expect((await statusOf(earlier.id)).status).toBe("superseded");
    expect((await statusOf(earlier.id)).decidedAt).not.toBeNull();
  });

  it("supersedes a pending row on a letter that has already been disposed", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    // Terminal statuses can carry a null assignee (the record was closed out),
    // so the owner test above does not cover them.
    for (const status of ["closed", "archived", "disposed"]) {
      const letter = await seedLetter(owner.workspace.id, {
        status,
        currentAssigneeId: null,
      });
      const pending = await seedPending(letter.id, owner.user.id);

      await runMigration();

      expect((await statusOf(pending.id)).status).toBe("superseded");
    }
  });

  it("leaves a genuinely open handover pending", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const letter = await seedLetter(owner.workspace.id, {
      status: "captured",
      currentAssigneeId: null,
    });
    const pending = await seedPending(letter.id, owner.user.id);

    await runMigration();

    expect((await statusOf(pending.id)).status).toBe("pending");
    expect((await statusOf(pending.id)).decidedAt).toBeNull();
  });

  it("is idempotent — a second run changes nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const bypassed = await createWorkspaceMember({ role: "member" });
    const letter = await seedLetter(owner.workspace.id, {
      status: "assigned",
      currentAssigneeId: owner.user.id,
    });
    const earlier = await seedPending(letter.id, bypassed.user.id);
    const current = await seedPending(letter.id, owner.user.id);

    await runMigration();
    const afterFirst = [await statusOf(current.id), await statusOf(earlier.id)];

    await runMigration();
    const afterSecond = [
      await statusOf(current.id),
      await statusOf(earlier.id),
    ];

    expect(afterSecond).toEqual(afterFirst);
  });
});
