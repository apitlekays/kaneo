import { and, eq, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { canAccessProject } from "../../utils/project-access";
import { addAssignee } from "../assignees-write";
import { assertValidTaskStatus } from "../validate-task-fields";
import getNextTaskNumber from "./get-next-task-number";

async function createTask({
  projectId,
  currentUserId,
  userId,
  userIds,
  title,
  status,
  startDate,
  dueDate,
  description,
  priority,
}: {
  projectId: string;
  currentUserId: string;
  userId?: string;
  // Several people at once. `userId` alone is the single-assignee form and
  // is folded in first, so it becomes the lead if it takes effect.
  userIds?: string[];
  title: string;
  status: string;
  startDate?: Date;
  dueDate?: Date;
  description?: string;
  priority?: string;
}) {
  const resolvedStatus = status || "to-do";
  const resolvedPriority = priority || "no-priority";

  await assertValidTaskStatus(resolvedStatus, projectId);

  const assigneeIds = [
    ...new Set([...(userId ? [userId] : []), ...(userIds ?? [])]),
  ].filter(Boolean);

  // A user can only be assigned a task in a project they belong to.
  if (assigneeIds.length > 0) {
    const [project] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1);
    for (const assigneeId of assigneeIds) {
      if (
        project &&
        !(await canAccessProject(assigneeId, projectId, project.workspaceId))
      ) {
        throw new HTTPException(400, {
          message: "User must be a member of the project to be assigned",
        });
      }
    }
  }

  const [assignee] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, assigneeIds[0] ?? ""));

  const nextTaskNumber = await getNextTaskNumber(projectId);

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, resolvedStatus),
    ),
  });

  const [maxPositionResult] = await db
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        column?.id
          ? eq(taskTable.columnId, column.id)
          : eq(taskTable.status, resolvedStatus),
      ),
    );

  const nextPosition = (maxPositionResult?.maxPosition ?? 0) + 1;

  const createdTask = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(taskTable)
      .values({
        projectId,
        userId: null,
        title: title || "",
        status: resolvedStatus,
        columnId: column?.id ?? null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        description: description || "",
        priority: resolvedPriority,
        number: nextTaskNumber + 1,
        position: nextPosition,
      })
      .returning();

    if (!inserted) {
      throw new HTTPException(500, {
        message: "Failed to create task",
      });
    }

    // Assigning someone other than the creator only offers the task to
    // them; they are on it once they accept. Self-assignment is
    // auto-accepted, so it takes effect immediately (and makes the creator
    // the lead).
    let applied = false;
    for (const assigneeId of assigneeIds) {
      const result = await addAssignee(tx, {
        taskId: inserted.id,
        userId: assigneeId,
        currentUserId,
      });
      if (result === "applied") applied = true;
    }

    if (!applied) return inserted;
    const [withLead] = await tx
      .select()
      .from(taskTable)
      .where(eq(taskTable.id, inserted.id))
      .limit(1);
    return withLead ?? inserted;
  });

  await publishEvent("task.created", {
    ...createdTask,
    taskId: createdTask.id,
    userId: createdTask.userId ?? "",
    currentUserId: currentUserId,
    type: "created",
    content: null,
  });

  return {
    ...createdTask,
    assigneeName: assignee?.name,
  };
}

export default createTask;
