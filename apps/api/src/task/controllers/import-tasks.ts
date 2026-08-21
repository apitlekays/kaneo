import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { writeTaskAssignment } from "../assignment-write";
import {
  coercePriority,
  coerceStatus,
  getValidTaskStatuses,
} from "../validate-task-fields";
import getNextTaskNumber from "./get-next-task-number";

export type ImportTask = {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
};

async function importTasks(
  projectId: string,
  tasksToImport: ImportTask[],
  currentUserId?: string,
) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  let taskNumber = await getNextTaskNumber(projectId);
  const validStatuses = await getValidTaskStatuses(projectId);

  const results = [];

  for (const taskData of tasksToImport) {
    try {
      const { status, warning: statusWarning } = coerceStatus(
        taskData.status,
        validStatuses,
      );
      const { priority, warning: priorityWarning } = coercePriority(
        taskData.priority || "low",
      );
      const warnings = [statusWarning, priorityWarning].filter(Boolean);

      const column = await db.query.columnTable.findFirst({
        where: and(
          eq(columnTable.projectId, projectId),
          eq(columnTable.slug, status),
        ),
      });

      const importedAssigneeId = taskData.userId || null;

      // Imported tasks go through the same assignment lifecycle as any other
      // task: assigning them to someone other than the importer only offers
      // the task (a `pending` row via writeTaskAssignment, task.userId left
      // null) rather than granting it outright - the same "offer, don't
      // grant" rule every other assignment path follows, even though it
      // means a large import can fire one prompt per assigned task. The one
      // exception is importing a task onto yourself: that auto-accepts, same
      // as every other self-assignment, since nobody should be prompted to
      // accept work they just imported onto themselves. A task imported with
      // no assignee is unaffected either way.
      const createdTask = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(taskTable)
          .values({
            projectId,
            userId: null,
            title: taskData.title,
            status,
            columnId: column?.id ?? null,
            startDate: taskData.startDate ? new Date(taskData.startDate) : null,
            dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
            description: taskData.description || "",
            priority,
            number: ++taskNumber,
          })
          .returning();

        if (!inserted) {
          return inserted;
        }

        if (importedAssigneeId) {
          const assignmentResult = await writeTaskAssignment(tx, {
            taskId: inserted.id,
            existingAssigneeId: null,
            nextAssigneeId: importedAssigneeId,
            currentUserId: currentUserId ?? "",
          });

          if (assignmentResult.status === "applied" && assignmentResult.task) {
            return assignmentResult.task;
          }
        }

        return inserted;
      });

      if (createdTask) {
        await publishEvent("task.created", {
          ...createdTask,
          taskId: createdTask.id,
          userId: createdTask.userId ?? "",
          currentUserId: currentUserId ?? "",
          type: "create",
          content: "imported the task",
        });

        results.push({
          success: true,
          task: createdTask,
          ...(warnings.length > 0 && { warnings }),
        });
      } else {
        results.push({
          success: false,
          error: "Failed to create task",
          task: taskData,
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      results.push({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        task: taskData,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
    },
    results: {
      total: tasksToImport.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      tasks: results,
    },
  };
}

export default importTasks;
