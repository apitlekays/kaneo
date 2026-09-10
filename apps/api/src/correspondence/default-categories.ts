import type db from "../database";
import { gmCategoryTable } from "../database/schema";
import { recordAuditEvent } from "./audit";

// The root db and a transaction share these methods. Matches audit.ts's
// (unexported) `DbExecutor` shape, since `recordAuditEvent` requires it.
type Tx = Pick<typeof db, "select" | "insert" | "execute">;

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
  tx: Tx,
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
