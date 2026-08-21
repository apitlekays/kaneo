import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import createNotification from "../../notification/controllers/create-notification";
import {
  assertCanDecideTask,
  taskAssigneeAfterDecision,
} from "../../task/assignment-rules";
import { getMemberProjectIds, isGlobalAdmin } from "../../utils/project-access";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

/** Row shape produced by the `list` query — kept beside its mapper so the
 * two stay in sync without a database round-trip in tests. */
type TaskAssignmentRow = {
  id: string;
  taskId: string;
  title: string;
  taskNumber: number | null;
  projectName: string;
  projectSlug: string;
  createdAt: Date;
};

/** Pure row-to-item mapper, extracted so it can be tested without a database. */
export function toPendingItem(row: TaskAssignmentRow): PendingDecisionItem {
  return {
    source: "task",
    id: row.id,
    title:
      row.taskNumber != null
        ? `${row.projectSlug}-${row.taskNumber}`
        : row.title,
    subtitle: row.title,
    context: [`Project: ${row.projectName}`],
    href: `/dashboard/tasks/${row.projectSlug}/${row.taskId}`,
    createdAt: row.createdAt,
    requiresReason: true,
  };
}

export const taskProvider: PendingDecisionProvider = {
  source: "task",

  async list(userId, workspaceId): Promise<PendingDecisionItem[]> {
    // Visibility is project-scoped: a task in a project the user is no
    // longer a member of must not surface as a decision they can make.
    const globalAdmin = await isGlobalAdmin(userId, workspaceId);
    const accessibleProjectIds = globalAdmin
      ? null
      : await getMemberProjectIds(userId, workspaceId);

    if (accessibleProjectIds && accessibleProjectIds.length === 0) return [];

    const rows = await db
      .select({
        id: taskAssignmentTable.id,
        taskId: taskAssignmentTable.taskId,
        title: taskTable.title,
        taskNumber: taskTable.number,
        projectName: projectTable.name,
        projectSlug: projectTable.slug,
        createdAt: taskAssignmentTable.createdAt,
      })
      .from(taskAssignmentTable)
      .innerJoin(taskTable, eq(taskAssignmentTable.taskId, taskTable.id))
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          eq(taskAssignmentTable.toUserId, userId),
          eq(taskAssignmentTable.status, "pending"),
          ...(accessibleProjectIds
            ? [inArray(taskTable.projectId, accessibleProjectIds)]
            : []),
        ),
      )
      .orderBy(desc(taskAssignmentTable.createdAt));

    return rows.map(toPendingItem);
  },

  async decide({ userId, workspaceId, id, decision, reason }) {
    // requiresReason: true above promises the client will always be asked
    // for one on rejection; enforce it here so a client that skips the
    // prompt (or a caller other than the web client) can't slip a
    // reasonless rejection into the record.
    if (decision === "rejected" && !reason?.trim()) {
      throw new HTTPException(400, {
        message: "A rejection must carry a reason",
      });
    }

    const [assignment] = await db
      .select({
        id: taskAssignmentTable.id,
        taskId: taskAssignmentTable.taskId,
        fromUserId: taskAssignmentTable.fromUserId,
        toUserId: taskAssignmentTable.toUserId,
        status: taskAssignmentTable.status,
        taskTitle: taskTable.title,
        projectId: taskTable.projectId,
      })
      .from(taskAssignmentTable)
      .innerJoin(taskTable, eq(taskAssignmentTable.taskId, taskTable.id))
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskAssignmentTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!assignment) throw new HTTPException(404, { message: "Not found" });
    assertCanDecideTask(assignment, userId);

    const decidedAt = new Date();
    const nextAssigneeId = taskAssigneeAfterDecision(
      decision,
      assignment.toUserId,
    );

    await db.transaction(async (tx) => {
      // The `pending` predicate is the concurrency guard: the assignment was
      // read outside this transaction, so a competing decision may have
      // landed since. Nothing else in here runs unless this update actually
      // claims the row.
      const decided = await tx
        .update(taskAssignmentTable)
        .set({
          status: decision,
          decidedAt,
          reason: decision === "rejected" ? reason : null,
        })
        .where(
          and(
            eq(taskAssignmentTable.id, id),
            eq(taskAssignmentTable.status, "pending"),
          ),
        )
        .returning({ id: taskAssignmentTable.id });
      if (decided.length === 0)
        throw new HTTPException(409, {
          message: "This assignment was already decided",
        });

      await tx
        .update(taskTable)
        .set({ userId: nextAssigneeId, updatedAt: decidedAt })
        .where(eq(taskTable.id, assignment.taskId));
    });

    if (decision === "accepted") {
      // The offer path no longer announces "assigned to you" — the task
      // isn't the offeree's until they accept. This is where it becomes
      // true, so this is where the event fires. Same payload shape as
      // update-task-assignee.ts's assignee_changed event: the task was
      // unassigned (userId null) while the offer was pending, and the
      // acting user here is the person who just accepted their own task.
      const [assignee] = await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);
      await publishEvent("task.assignee_changed", {
        taskId: assignment.taskId,
        projectId: assignment.projectId,
        userId,
        oldAssignee: null,
        newAssignee: assignee?.name,
        newAssigneeId: userId,
        title: assignment.taskTitle,
        type: "assignee_changed",
      });
    }

    // A lead routing twenty tasks must not have the declined ones collect on
    // their own board — the task simply becomes unassigned. Only the
    // assigner is told, and only when there is one to tell: grandfathered
    // rows with no recorded assigner notify nobody rather than inventing one.
    if (decision === "rejected" && assignment.fromUserId) {
      await createNotification({
        userId: assignment.fromUserId,
        type: "task_rejected",
        title: `Assignment declined — ${assignment.taskTitle}`,
        content: reason,
        resourceId: assignment.taskId,
        resourceType: "task",
      }).catch(() => {});
    }
  },
};
