import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  taskAssigneeTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../database/schema";

export type TaskAssigneeSummary = {
  userId: string;
  name: string | null;
  image: string | null;
  isLead: boolean;
};

export type PendingAssigneeSummary = {
  userId: string;
  name: string | null;
};

export type TaskAssigneesFields = {
  assignees: TaskAssigneeSummary[];
  pendingAssignees: PendingAssigneeSummary[];
  // Deprecated single-value view of pendingAssignees, kept for one release
  // so a client built before multi-assignee still renders the pending badge.
  pendingAssigneeName: string | null;
};

const EMPTY: TaskAssigneesFields = {
  assignees: [],
  pendingAssignees: [],
  pendingAssigneeName: null,
};

/**
 * Everyone on each task (lead first) and everyone a task is still offered
 * to, for a page of task ids. Two flat queries rather than joins onto the
 * task query: a task can now have several of each, and joining would
 * multiply task rows and break pagination.
 */
export async function loadTaskAssignees(
  taskIds: string[],
): Promise<Map<string, TaskAssigneesFields>> {
  const result = new Map<string, TaskAssigneesFields>();
  if (taskIds.length === 0) return result;

  const [people, offers] = await Promise.all([
    db
      .select({
        taskId: taskAssigneeTable.taskId,
        userId: taskAssigneeTable.userId,
        isLead: taskAssigneeTable.isLead,
        name: userTable.name,
        image: userTable.image,
      })
      .from(taskAssigneeTable)
      .innerJoin(userTable, eq(taskAssigneeTable.userId, userTable.id))
      .where(inArray(taskAssigneeTable.taskId, taskIds))
      .orderBy(
        desc(taskAssigneeTable.isLead),
        asc(taskAssigneeTable.createdAt),
        asc(taskAssigneeTable.id),
      ),
    db
      .select({
        taskId: taskAssignmentTable.taskId,
        userId: taskAssignmentTable.toUserId,
        name: userTable.name,
      })
      .from(taskAssignmentTable)
      .innerJoin(userTable, eq(taskAssignmentTable.toUserId, userTable.id))
      .where(
        and(
          inArray(taskAssignmentTable.taskId, taskIds),
          eq(taskAssignmentTable.status, "pending"),
        ),
      )
      .orderBy(asc(taskAssignmentTable.createdAt), asc(taskAssignmentTable.id)),
  ]);

  const entry = (taskId: string) => {
    let fields = result.get(taskId);
    if (!fields) {
      fields = {
        assignees: [],
        pendingAssignees: [],
        pendingAssigneeName: null,
      };
      result.set(taskId, fields);
    }
    return fields;
  };

  for (const p of people) {
    entry(p.taskId).assignees.push({
      userId: p.userId,
      name: p.name,
      image: p.image,
      isLead: p.isLead,
    });
  }
  for (const o of offers) {
    if (!o.userId) continue;
    const fields = entry(o.taskId);
    fields.pendingAssignees.push({ userId: o.userId, name: o.name });
    fields.pendingAssigneeName ??= o.name;
  }

  return result;
}

/** The loaded fields for one task, or empty ones when it has nobody. */
export function assigneesFor(
  map: Map<string, TaskAssigneesFields>,
  taskId: string,
): TaskAssigneesFields {
  return map.get(taskId) ?? EMPTY;
}

/** True for a task the user has accepted, as lead or collaborator. */
export function isAssignedTo(userId: string): SQL {
  return sql`exists (select 1 from ${taskAssigneeTable} where ${taskAssigneeTable.taskId} = ${taskTable.id} and ${taskAssigneeTable.userId} = ${userId})`;
}

/**
 * Everyone who should hear about a change to a task: every accepted
 * assignee except whoever made the change. `fallbackId` covers an event
 * that names an assignee for a task with no assignee rows (none should
 * exist after the backfill, but a notification is not worth losing).
 */
export async function taskRecipients(
  taskId: string,
  actorId: string | null | undefined,
  fallbackId?: string | null,
): Promise<string[]> {
  const rows = await db
    .select({ userId: taskAssigneeTable.userId })
    .from(taskAssigneeTable)
    .where(eq(taskAssigneeTable.taskId, taskId));
  const ids = rows.map((r) => r.userId);
  if (ids.length === 0 && fallbackId) ids.push(fallbackId);
  return ids.filter((id) => id !== actorId);
}
