import { HTTPException } from "hono/http-exception";
import getTasks from "../../task/controllers/get-tasks";

/**
 * Who a task is still *offered* to is internal routing, not something an
 * anonymous visitor of a public board should see. The people who have
 * accepted it are shown, as the single assignee always was.
 */
function withoutOffers<T extends object>(task: T) {
  const {
    pendingAssignees: _pendingAssignees,
    pendingAssigneeName: _pendingAssigneeName,
    ...rest
  } = task as T & { pendingAssignees?: unknown; pendingAssigneeName?: unknown };
  return rest;
}

export async function getPublicProject(id: string) {
  const result = await getTasks(id);

  if (!result.data) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  if (!result.data.isPublic) {
    throw new HTTPException(403, {
      message: "Project is not public",
    });
  }

  const data = result.data;
  return {
    ...data,
    columns: data.columns.map((column) => ({
      ...column,
      tasks: column.tasks.map(withoutOffers),
    })),
    archivedTasks: data.archivedTasks.map(withoutOffers),
    plannedTasks: data.plannedTasks.map(withoutOffers),
  };
}
