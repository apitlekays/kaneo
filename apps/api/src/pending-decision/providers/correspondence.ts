import { and, desc, eq, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { SEALED_LETTER_STATUSES } from "../../correspondence/letter-list-filter";
import { decideLetterAssignment } from "../../correspondence/letters";
import db from "../../database";
import { letterAssignmentTable, letterTable } from "../../database/schema";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

/** A letter decision needs both ids, so the opaque item id carries both. */
export function encodeLetterDecisionId(
  letterId: string,
  assignmentId: string,
): string {
  return `${letterId}:${assignmentId}`;
}

export function decodeLetterDecisionId(id: string): {
  letterId: string;
  assignmentId: string;
} {
  const [letterId, assignmentId, ...rest] = id.split(":");
  if (!letterId || !assignmentId || rest.length > 0)
    throw new HTTPException(400, { message: "Malformed decision id" });
  return { letterId, assignmentId };
}

/** Row shape produced by the `list` query — kept beside its mapper so the
 * two stay in sync without a database round-trip in tests. */
type LetterAssignmentRow = {
  id: string;
  letterId: string;
  action: string | null;
  note: string | null;
  createdAt: Date;
  refNo: string | null;
  subject: string;
  urgency: string;
};

/** Pure row-to-item mapper, extracted so it can be tested without a database. */
export function toPendingItem(row: LetterAssignmentRow): PendingDecisionItem {
  return {
    source: "correspondence",
    id: encodeLetterDecisionId(row.letterId, row.id),
    title: row.refNo ?? "Unregistered",
    subtitle: row.subject,
    context: [
      `Action: ${row.action}`,
      ...(row.note ? [`Instruction: ${row.note}`] : []),
    ],
    href: `/dashboard/correspondence/${row.letterId}`,
    createdAt: row.createdAt,
    requiresReason: true,
    ...(row.urgency === "urgent"
      ? { badges: [{ label: "Urgent", tone: "urgent" as const }] }
      : {}),
  };
}

export const correspondenceProvider: PendingDecisionProvider = {
  source: "correspondence",

  async list(userId, workspaceId): Promise<PendingDecisionItem[]> {
    const rows = await db
      .select({
        id: letterAssignmentTable.id,
        letterId: letterAssignmentTable.letterId,
        action: letterAssignmentTable.action,
        note: letterAssignmentTable.note,
        createdAt: letterAssignmentTable.createdAt,
        refNo: letterTable.refNo,
        subject: letterTable.subject,
        urgency: letterTable.urgency,
      })
      .from(letterAssignmentTable)
      .innerJoin(
        letterTable,
        eq(letterAssignmentTable.letterId, letterTable.id),
      )
      .where(
        and(
          eq(letterTable.workspaceId, workspaceId),
          eq(letterAssignmentTable.toUserId, userId),
          eq(letterAssignmentTable.status, "pending"),
          // A sealed record cannot be accepted or rejected, so offering the
          // decision would present an item the user can never clear.
          notInArray(letterTable.status, [...SEALED_LETTER_STATUSES]),
        ),
      )
      .orderBy(desc(letterAssignmentTable.createdAt));

    return rows.map(toPendingItem);
  },

  async decide({ userId, workspaceId, id, decision, reason, ip }) {
    // requiresReason: true above promises the client will always be asked
    // for one on rejection; enforce it here so a client that skips the
    // prompt (or a caller other than the web client) can't slip a
    // reasonless rejection into the audit log.
    if (decision === "rejected" && !reason?.trim()) {
      throw new HTTPException(400, {
        message: "A rejection must carry a reason",
      });
    }

    const { letterId, assignmentId } = decodeLetterDecisionId(id);
    await decideLetterAssignment({
      workspaceId,
      userId,
      letterId,
      assignmentId,
      decision,
      // The old accept route hard-codes null so acceptance never carries a
      // note into the audit chain (`after.reason` is canonicalized and
      // hashed into the chain). Mirror that here so accepting through this
      // provider can't seal actor-supplied text a rejection would.
      reason: decision === "rejected" ? reason : null,
      ip,
    });
  },
};
