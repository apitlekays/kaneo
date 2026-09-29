import { eq } from "drizzle-orm";
import db from "../database";
import { taskTable, userTable } from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { broadcastToUser } from "../ws";

/**
 * Tells someone a task was offered to them. Before this, an offer was
 * silent: the offeree found out only when their pending-decision dialog
 * next refetched. It is deliberately not `task_assignee_changed` — the
 * task is not theirs until they accept.
 *
 * Call after the offer's transaction has committed. A failure to notify
 * never fails the assignment itself.
 */
export async function announceTaskOffer({
  taskId,
  toUserId,
  fromUserId,
}: {
  taskId: string;
  toUserId: string;
  fromUserId: string | null;
}) {
  try {
    const [task] = await db
      .select({ title: taskTable.title })
      .from(taskTable)
      .where(eq(taskTable.id, taskId))
      .limit(1);
    const [from] = fromUserId
      ? await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, fromUserId))
          .limit(1)
      : [];

    await createNotification({
      userId: toUserId,
      type: "task_offered",
      title: `Task offered — ${task?.title ?? "a task"}`,
      content: `${from?.name ?? "Someone"} asked you to take this task. Accept or decline it from your pending decisions.`,
      resourceId: taskId,
      resourceType: "task",
    });
  } catch (error) {
    console.error("Failed to announce task offer", { taskId, error });
  }

  // Refresh the offeree's pending-decision dialog live, the way letter
  // handovers already do.
  broadcastToUser(toUserId, { entity: "task-assignment" });
}
