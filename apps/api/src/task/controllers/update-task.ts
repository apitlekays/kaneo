import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { writeTaskAssignment } from "../assignment-write";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTask(
  id: string,
  title: string,
  status: string,
  startDate: Date | undefined,
  dueDate: Date | undefined,
  projectId: string,
  description: string,
  priority: string,
  position: number,
  userId?: string,
  currentUserId?: string,
) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  await assertValidTaskStatus(status, projectId);

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, status),
    ),
  });

  const nextAssigneeId = userId || null;

  const updatedTask = await db.transaction(async (tx) => {
    // The assignee is handled separately below: a full-object PUT that
    // happens to change the assignee is still an assignment (offer vs.
    // apply-immediately), and one that doesn't touch the assignee must not
    // disturb a live pending offer or write a spurious assignment row.
    const [updated] = await tx
      .update(taskTable)
      .set({
        title,
        status,
        columnId: column?.id ?? null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        projectId,
        description,
        priority,
        position,
      })
      .where(eq(taskTable.id, id))
      .returning();

    if (!updated) {
      throw new HTTPException(500, {
        message: "Failed to update task",
      });
    }

    // A full-object PUT has no way to say "leave the assignee alone" - the
    // client always echoes its last-known task.userId in this field, even
    // when only editing e.g. the title. So unlike the dedicated assignee
    // endpoint (where the same value is a deliberate reassignment worth
    // re-checking against a live pending offer), here a same-value payload
    // is only ever "untouched" and must be a hard no-op: it must not
    // supersede a live pending offer, whose target this field cannot even
    // represent (task.userId stays null while an offer is outstanding).
    if (nextAssigneeId === existingTask.userId) {
      return updated;
    }

    const { status: assignmentStatus, task: assignedTask } =
      await writeTaskAssignment(tx, {
        taskId: id,
        existingAssigneeId: existingTask.userId,
        nextAssigneeId,
        currentUserId: currentUserId ?? "",
      });

    if (assignmentStatus === "applied" && assignedTask) {
      return { ...updated, userId: assignedTask.userId };
    }

    return updated;
  });

  if (existingTask.status !== status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });
  }

  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });

  if (existingTask.description !== description) {
    deleteOrphanedAssets(existingTask.description, description, {
      taskId: id,
    }).catch(() => {});
  }

  return updatedTask;
}

export default updateTask;
