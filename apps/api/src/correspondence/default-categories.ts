import { gmCategoryTable, gmMediumTable } from "../database/schema";
import { type DbExecutor, recordAuditEvent } from "./audit";

/**
 * The default Correspondence categories seeded into every new workspace.
 * Order matters: it is the order the categories dropdown renders in (see
 * `seedDefaultCategories` below and the `asc(gmCategoryTable.createdAt)`
 * ordering in `correspondence/index.ts`'s list route). The first three
 * match the keys already live in production, typed in by hand on 2 July
 * 2026 — do not change their `key` spelling, and do not "correct"
 * `informations` to `information`; it is the user's domain vocabulary.
 */
export const DEFAULT_GM_CATEGORIES: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "complaints", label: "Complaints" },
  { key: "invitations", label: "Invitations" },
  { key: "request-for-funding", label: "Request For Funding" },
  { key: "informations", label: "Informations" },
  { key: "announcements", label: "Announcements" },
  { key: "reminders", label: "Reminders" },
  { key: "billings", label: "Billings" },
  { key: "human-resources", label: "Human Resources" },
  { key: "queries", label: "Queries" },
  { key: "requests", label: "Requests" },
];

/**
 * Seed the default Correspondence categories for a newly created workspace.
 *
 * MUST be called inside a `db.transaction(...)` — each inserted row gets a
 * matching `gm_audit_event` via `recordAuditEvent`, which must commit
 * atomically with the row it describes.
 *
 * Idempotent: `gm_category` has a unique constraint on
 * `(workspace_id, key)`, so a row that already exists is skipped via
 * `onConflictDoNothing`, and no audit event is recorded for a skipped row.
 *
 * Each row gets its own `createdAt`, incremented by one millisecond per
 * row, so the list route's `asc(gmCategoryTable.createdAt)` ordering
 * reproduces the intended order above rather than a nondeterministic order
 * from every row sharing one timestamp.
 */
export async function seedDefaultCategories(
  tx: DbExecutor,
  workspaceId: string,
  actorId: string,
) {
  const now = Date.now();
  for (const [index, category] of DEFAULT_GM_CATEGORIES.entries()) {
    const [row] = await tx
      .insert(gmCategoryTable)
      .values({
        workspaceId,
        key: category.key,
        label: category.label,
        createdAt: new Date(now + index),
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await recordAuditEvent(tx, {
        workspaceId,
        entityType: "gm_category",
        entityId: row.id,
        action: "create",
        actorId,
        after: row,
      });
    }
  }
}

/**
 * The default letter mediums. Their keys are the values letters stored
 * before mediums became configurable — keep them, or old letters lose their
 * label. Migration 0069 seeded the same four into every existing workspace.
 */
export const DEFAULT_GM_MEDIUMS: ReadonlyArray<{ key: string; label: string }> =
  [
    { key: "email", label: "Email" },
    { key: "physical", label: "Physical" },
    { key: "hand", label: "By hand" },
    { key: "portal", label: "Portal" },
  ];

/** Seed the default mediums for a new workspace. Same rules as categories. */
export async function seedDefaultMediums(
  tx: DbExecutor,
  workspaceId: string,
  actorId: string,
) {
  const now = Date.now();
  for (const [index, medium] of DEFAULT_GM_MEDIUMS.entries()) {
    const [row] = await tx
      .insert(gmMediumTable)
      .values({
        workspaceId,
        key: medium.key,
        label: medium.label,
        createdAt: new Date(now + index),
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await recordAuditEvent(tx, {
        workspaceId,
        entityType: "gm_medium",
        entityId: row.id,
        action: "create",
        actorId,
        after: row,
      });
    }
  }
}
