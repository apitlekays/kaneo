import { and, asc, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import {
  taskAssigneeTable,
  taskAssignmentTable,
  taskTable,
} from "../database/schema";

export type DbOrTx =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The only writer of `task_assignee` and of `task.assignee_id`.
 *
 * Invariant: `task.assignee_id` is the user of the task's `is_lead` row, or
 * null when nobody is on the task. Every exported function ends in
 * `syncLead`, which repairs the lead (earliest-joined person) if the
 * previous one left, and mirrors it onto the task row.
 *
 * Only accepted people are on a task. Offering it to someone else writes a
 * `pending` task_assignment row and nothing here; the person joins when
 * they accept (`acceptOffer`).
 */

async function syncLead(tx: DbOrTx, taskId: string): Promise<string | null> {
  const people = await tx
    .select({
      id: taskAssigneeTable.id,
      userId: taskAssigneeTable.userId,
      isLead: taskAssigneeTable.isLead,
    })
    .from(taskAssigneeTable)
    .where(eq(taskAssigneeTable.taskId, taskId))
    .orderBy(asc(taskAssigneeTable.createdAt), asc(taskAssigneeTable.id));

  const lead = people.find((p) => p.isLead) ?? people[0] ?? null;

  if (lead && !lead.isLead) {
    await tx
      .update(taskAssigneeTable)
      .set({ isLead: true })
      .where(eq(taskAssigneeTable.id, lead.id));
  }

  const leadUserId = lead?.userId ?? null;
  await tx
    .update(taskTable)
    .set({ userId: leadUserId })
    .where(eq(taskTable.id, taskId));

  return leadUserId;
}

async function isOnTask(tx: DbOrTx, taskId: string, userId: string) {
  const [row] = await tx
    .select({ id: taskAssigneeTable.id })
    .from(taskAssigneeTable)
    .where(
      and(
        eq(taskAssigneeTable.taskId, taskId),
        eq(taskAssigneeTable.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

async function hasPendingOffer(tx: DbOrTx, taskId: string, userId: string) {
  const [row] = await tx
    .select({ id: taskAssignmentTable.id })
    .from(taskAssignmentTable)
    .where(
      and(
        eq(taskAssignmentTable.taskId, taskId),
        eq(taskAssignmentTable.toUserId, userId),
        eq(taskAssignmentTable.status, "pending"),
      ),
    )
    .limit(1);
  return !!row;
}

/** Puts an accepted person on the task; the lead if there is none yet. */
async function join(tx: DbOrTx, taskId: string, userId: string) {
  await tx
    .insert(taskAssigneeTable)
    .values({ taskId, userId })
    .onConflictDoNothing({
      target: [taskAssigneeTable.taskId, taskAssigneeTable.userId],
    });
}

async function supersedePending(tx: DbOrTx, taskId: string, userId?: string) {
  await tx
    .update(taskAssignmentTable)
    .set({ status: "superseded", decidedAt: new Date() })
    .where(
      and(
        eq(taskAssignmentTable.taskId, taskId),
        eq(taskAssignmentTable.status, "pending"),
        ...(userId ? [eq(taskAssignmentTable.toUserId, userId)] : []),
      ),
    );
}

async function recordSelfAssignment(
  tx: DbOrTx,
  taskId: string,
  userId: string,
) {
  await tx.insert(taskAssignmentTable).values({
    taskId,
    fromUserId: userId,
    toUserId: userId,
    status: "accepted",
    decidedAt: new Date(),
  });
}

export type AddAssigneeStatus = "no-op" | "offered" | "applied";

/**
 * Adds one person alongside whoever is already on the task. Adding
 * yourself takes effect at once; adding anyone else offers it to them.
 * Nobody else's offer is disturbed.
 */
export async function addAssignee(
  tx: DbOrTx,
  {
    taskId,
    userId,
    currentUserId,
  }: { taskId: string; userId: string; currentUserId: string },
): Promise<AddAssigneeStatus> {
  if (await isOnTask(tx, taskId, userId)) return "no-op";
  if (await hasPendingOffer(tx, taskId, userId)) return "no-op";

  if (userId === currentUserId) {
    await join(tx, taskId, userId);
    await recordSelfAssignment(tx, taskId, userId);
    await syncLead(tx, taskId);
    return "applied";
  }

  await tx.insert(taskAssignmentTable).values({
    taskId,
    fromUserId: currentUserId,
    toUserId: userId,
    status: "pending",
    exclusive: false,
  });
  return "offered";
}

export type RemoveAssigneeStatus = "no-op" | "removed" | "withdrawn";

/**
 * Takes one person off the task, or withdraws the offer still waiting on
 * them. Removing the lead hands the lead to the earliest remaining person.
 */
export async function removeAssignee(
  tx: DbOrTx,
  { taskId, userId }: { taskId: string; userId: string },
): Promise<RemoveAssigneeStatus> {
  const hadOffer = await hasPendingOffer(tx, taskId, userId);
  await supersedePending(tx, taskId, userId);

  const removed = await tx
    .delete(taskAssigneeTable)
    .where(
      and(
        eq(taskAssigneeTable.taskId, taskId),
        eq(taskAssigneeTable.userId, userId),
      ),
    )
    .returning({ id: taskAssigneeTable.id });

  if (removed.length === 0) return hadOffer ? "withdrawn" : "no-op";

  await syncLead(tx, taskId);
  return "removed";
}

/** Makes an accepted person the lead. */
export async function setLead(
  tx: DbOrTx,
  { taskId, userId }: { taskId: string; userId: string },
): Promise<void> {
  if (!(await isOnTask(tx, taskId, userId))) {
    throw new HTTPException(400, {
      message: "Only someone who has accepted the task can lead it",
    });
  }

  // Clear first: the partial unique index allows one lead at a time.
  await tx
    .update(taskAssigneeTable)
    .set({ isLead: false })
    .where(
      and(
        eq(taskAssigneeTable.taskId, taskId),
        ne(taskAssigneeTable.userId, userId),
      ),
    );
  await tx
    .update(taskAssigneeTable)
    .set({ isLead: true })
    .where(
      and(
        eq(taskAssigneeTable.taskId, taskId),
        eq(taskAssigneeTable.userId, userId),
      ),
    );
  await syncLead(tx, taskId);
}

/**
 * Applies an accepted offer. An exclusive offer (made through a
 * single-value route) makes the accepter the only person on the task, as
 * accepting did before tasks could have several; otherwise they join.
 */
export async function acceptOffer(
  tx: DbOrTx,
  {
    taskId,
    userId,
    exclusive,
  }: { taskId: string; userId: string; exclusive: boolean },
): Promise<void> {
  if (exclusive) {
    await tx
      .delete(taskAssigneeTable)
      .where(
        and(
          eq(taskAssigneeTable.taskId, taskId),
          ne(taskAssigneeTable.userId, userId),
        ),
      );
  }
  await join(tx, taskId, userId);
  await syncLead(tx, taskId);
}

export type ReplaceAssigneesStatus = "no-op" | "offered" | "applied";

/**
 * "Make this person the only assignee" — the meaning every single-value
 * route (assignee PUT, full task PUT, import, MCP) had before tasks could
 * have several people, preserved exactly:
 *
 * - null clears everyone and withdraws every offer;
 * - yourself, or someone already on the task, takes effect at once and
 *   removes everyone else;
 * - anyone else is offered the task exclusively; the people on it stay
 *   until that offer is accepted.
 *
 * Every other pending offer is superseded, so at most one offer is live
 * afterwards. It is a true no-op only when the task already has exactly
 * that one person (or nobody, for null) and no offer is waiting.
 */
export async function replaceAssignees(
  tx: DbOrTx,
  {
    taskId,
    nextAssigneeId,
    currentUserId,
  }: { taskId: string; nextAssigneeId: string | null; currentUserId: string },
): Promise<ReplaceAssigneesStatus> {
  const people = await tx
    .select({ userId: taskAssigneeTable.userId })
    .from(taskAssigneeTable)
    .where(eq(taskAssigneeTable.taskId, taskId));
  const [anyPending] = await tx
    .select({ id: taskAssignmentTable.id })
    .from(taskAssignmentTable)
    .where(
      and(
        eq(taskAssignmentTable.taskId, taskId),
        eq(taskAssignmentTable.status, "pending"),
      ),
    )
    .limit(1);

  const alreadyExactly =
    nextAssigneeId === null
      ? people.length === 0
      : people.length === 1 && people[0]?.userId === nextAssigneeId;
  if (alreadyExactly && !anyPending) return "no-op";

  await supersedePending(tx, taskId);

  if (nextAssigneeId === null) {
    await tx
      .delete(taskAssigneeTable)
      .where(eq(taskAssigneeTable.taskId, taskId));
    await syncLead(tx, taskId);
    return "applied";
  }

  const isSelf = nextAssigneeId === currentUserId;
  const alreadyAccepted = people.some((p) => p.userId === nextAssigneeId);

  if (isSelf || alreadyAccepted) {
    await tx
      .delete(taskAssigneeTable)
      .where(
        and(
          eq(taskAssigneeTable.taskId, taskId),
          ne(taskAssigneeTable.userId, nextAssigneeId),
        ),
      );
    await join(tx, taskId, nextAssigneeId);
    if (isSelf && !alreadyAccepted) {
      await recordSelfAssignment(tx, taskId, nextAssigneeId);
    }
    await syncLead(tx, taskId);
    return "applied";
  }

  await tx.insert(taskAssignmentTable).values({
    taskId,
    fromUserId: currentUserId,
    toUserId: nextAssigneeId,
    status: "pending",
    exclusive: true,
  });
  return "offered";
}
