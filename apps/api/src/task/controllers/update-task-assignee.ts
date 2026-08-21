import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskAssignmentTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { canAccessProject } from "../../utils/project-access";

async function updateTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string;
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const nextAssigneeId = userId || null;
  // A no-op only when there is an accepted assignee already and nothing
  // would change. Clearing (nextAssigneeId === null) always runs through,
  // even if task.userId is already null, because a pending offer for this
  // task may still need to be superseded.
  if (nextAssigneeId !== null && existingTask.userId === nextAssigneeId) {
    return existingTask;
  }

  // A user can only be assigned a task in a project they belong to.
  if (nextAssigneeId) {
    const [project] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(eq(projectTable.id, existingTask.projectId))
      .limit(1);
    if (
      project &&
      !(await canAccessProject(
        nextAssigneeId,
        existingTask.projectId,
        project.workspaceId,
      ))
    ) {
      throw new HTTPException(400, {
        message: "User must be a member of the project to be assigned",
      });
    }
  }

  // Assigning to someone other than the caller only offers the task to
  // them; task.userId (the accepted assignee) is untouched until they
  // accept. Self-assignment and clearing keep today's behaviour and take
  // effect immediately.
  const isSelfAssignment = nextAssigneeId === currentUserId;
  const isOffer = nextAssigneeId !== null && !isSelfAssignment;

  const resultTask = await db.transaction(async (tx) => {
    // Exactly one live prompt per task: retire any assignment still
    // awaiting a decision before this change takes effect.
    await tx
      .update(taskAssignmentTable)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(
        and(
          eq(taskAssignmentTable.taskId, id),
          eq(taskAssignmentTable.status, "pending"),
        ),
      );

    if (isOffer) {
      await tx.insert(taskAssignmentTable).values({
        taskId: id,
        fromUserId: currentUserId,
        toUserId: nextAssigneeId,
        status: "pending",
      });

      // The task is not theirs yet - that is the whole feature.
      return existingTask;
    }

    const [updatedTask] = await tx
      .update(taskTable)
      .set({ userId: nextAssigneeId })
      .where(eq(taskTable.id, id))
      .returning();

    if (!updatedTask) {
      throw new HTTPException(500, {
        message: "Failed to update task assignee",
      });
    }

    if (isSelfAssignment) {
      await tx.insert(taskAssignmentTable).values({
        taskId: id,
        fromUserId: currentUserId,
        toUserId: nextAssigneeId,
        status: "accepted",
        decidedAt: new Date(),
      });
    }

    return updatedTask;
  });

  const newAssigneeName = userId
    ? (
        await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, userId))
          .limit(1)
      )[0]?.name
    : undefined;

  if (!userId) {
    await publishEvent("task.unassigned", {
      taskId: resultTask.id,
      projectId: resultTask.projectId,
      userId: currentUserId,
      title: resultTask.title,
      type: "unassigned",
    });

    return resultTask;
  }

  await publishEvent("task.assignee_changed", {
    taskId: resultTask.id,
    projectId: resultTask.projectId,
    userId: currentUserId,
    oldAssignee: existingTask.userId,
    newAssignee: newAssigneeName,
    newAssigneeId: userId,
    title: resultTask.title,
    type: "assignee_changed",
  });

  return resultTask;
}

export default updateTaskAssignee;
