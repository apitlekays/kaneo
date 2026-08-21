import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { canAccessProject } from "../../utils/project-access";
import { writeTaskAssignment } from "../assignment-write";

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

  const { status, task: writtenTask } = await db.transaction((tx) =>
    writeTaskAssignment(tx, {
      taskId: id,
      existingAssigneeId: existingTask.userId,
      nextAssigneeId,
      currentUserId,
    }),
  );

  if (status === "no-op") {
    return existingTask;
  }

  const resultTask =
    status === "applied" && writtenTask ? writtenTask : existingTask;

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

  // The offer path does not announce "assigned to you" - the task is not
  // the offeree's until they accept. That is where task.assignee_changed
  // now fires instead (see pending-decision/providers/task.ts). Only the
  // paths that take effect immediately (self-assignment) publish here.
  if (status === "applied") {
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
  }

  return resultTask;
}

export default updateTaskAssignee;
