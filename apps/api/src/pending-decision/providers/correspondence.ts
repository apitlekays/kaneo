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

    return rows.map((row) => ({
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
    }));
  },

  async decide({ userId, workspaceId, id, decision, reason, ip }) {
    const { letterId, assignmentId } = decodeLetterDecisionId(id);
    await decideLetterAssignment({
      workspaceId,
      userId,
      letterId,
      assignmentId,
      decision,
      reason,
      ip,
    });
  },
};
