import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../../database";
import {
  taskAssignmentTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../../database/schema";

const pendingAssigneeUserTable = alias(userTable, "pendingAssigneeUserTable");

async function getTaskRelations(taskId: string) {
  const relations = await db
    .select({
      id: taskRelationTable.id,
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
      relationType: taskRelationTable.relationType,
      createdAt: taskRelationTable.createdAt,
    })
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    );

  const taskIds = new Set<string>();
  for (const rel of relations) {
    taskIds.add(rel.sourceTaskId);
    taskIds.add(rel.targetTaskId);
  }

  const tasks = new Map<
    string,
    {
      id: string;
      title: string;
      status: string;
      priority: string | null;
      number: number | null;
      projectId: string;
      userId: string | null;
      assigneeName: string | null;
      pendingAssigneeName: string | null;
    }
  >();

  if (taskIds.size > 0) {
    const taskRows = await db
      .select({
        id: taskTable.id,
        title: taskTable.title,
        status: taskTable.status,
        priority: taskTable.priority,
        number: taskTable.number,
        projectId: taskTable.projectId,
        userId: taskTable.userId,
        assigneeName: userTable.name,
        pendingAssigneeName: pendingAssigneeUserTable.name,
      })
      .from(taskTable)
      .leftJoin(userTable, eq(taskTable.userId, userTable.id))
      .leftJoin(
        taskAssignmentTable,
        and(
          eq(taskAssignmentTable.taskId, taskTable.id),
          eq(taskAssignmentTable.status, "pending"),
        ),
      )
      .leftJoin(
        pendingAssigneeUserTable,
        eq(taskAssignmentTable.toUserId, pendingAssigneeUserTable.id),
      )
      .where(inArray(taskTable.id, [...taskIds]));

    for (const task of taskRows) {
      tasks.set(task.id, task);
    }
  }

  return relations.map((rel) => ({
    ...rel,
    sourceTask: tasks.get(rel.sourceTaskId) ?? null,
    targetTask: tasks.get(rel.targetTaskId) ?? null,
  }));
}

export default getTaskRelations;
