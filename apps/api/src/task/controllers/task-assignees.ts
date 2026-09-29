import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { canAccessProject } from "../../utils/project-access";
import { announceTaskOffer } from "../announce-offer";
import { addAssignee, removeAssignee, setLead } from "../assignees-write";

async function loadTask(id: string) {
  const task = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

async function userName(userId: string) {
  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user?.name;
}

/**
 * The lead is what calendar sync and every single-assignee consumer follow,
 * so a change of lead is announced exactly like a reassignment was.
 */
async function announceLeadChange(
  task: typeof taskTable.$inferSelect,
  previousLeadId: string | null,
  currentUserId: string,
) {
  const [after] = await db
    .select({ userId: taskTable.userId })
    .from(taskTable)
    .where(eq(taskTable.id, task.id))
    .limit(1);
  const nextLeadId = after?.userId ?? null;
  if (nextLeadId === previousLeadId) return;

  if (!nextLeadId) {
    await publishEvent("task.unassigned", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      title: task.title,
      type: "unassigned",
    });
    return;
  }

  await publishEvent("task.assignee_changed", {
    taskId: task.id,
    projectId: task.projectId,
    userId: currentUserId,
    oldAssignee: previousLeadId,
    newAssignee: await userName(nextLeadId),
    newAssigneeId: nextLeadId,
    title: task.title,
    type: "assignee_changed",
  });
}

export async function addTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string;
  currentUserId: string;
}) {
  const task = await loadTask(id);

  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, task.projectId))
    .limit(1);
  if (
    project &&
    !(await canAccessProject(userId, task.projectId, project.workspaceId))
  ) {
    throw new HTTPException(400, {
      message: "User must be a member of the project to be assigned",
    });
  }

  const status = await db.transaction((tx) =>
    addAssignee(tx, { taskId: id, userId, currentUserId }),
  );

  // An offer is not an assignment — task.assignee_changed waits for the
  // accept (pending-decision/providers/task.ts). The offeree is told they
  // were offered it instead.
  if (status === "applied") {
    await announceLeadChange(task, task.userId, currentUserId);
  }
  if (status === "offered") {
    await announceTaskOffer({
      taskId: id,
      toUserId: userId,
      fromUserId: currentUserId,
    });
  }

  return { status };
}

export async function removeTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string;
  currentUserId: string;
}) {
  const task = await loadTask(id);
  const status = await db.transaction((tx) =>
    removeAssignee(tx, { taskId: id, userId }),
  );
  if (status === "removed") {
    await announceLeadChange(task, task.userId, currentUserId);
  }
  return { status };
}

export async function setTaskLead({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string;
  currentUserId: string;
}) {
  const task = await loadTask(id);
  await db.transaction((tx) => setLead(tx, { taskId: id, userId }));
  await announceLeadChange(task, task.userId, currentUserId);
  return { status: "applied" as const };
}
