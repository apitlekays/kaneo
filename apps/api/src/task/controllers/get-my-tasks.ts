import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  labelTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { getMemberProjectIds, isGlobalAdmin } from "../../utils/project-access";

const priorityCaseExpr = sql<number>`CASE
  WHEN ${taskTable.priority} = 'urgent' THEN 4
  WHEN ${taskTable.priority} = 'high' THEN 3
  WHEN ${taskTable.priority} = 'medium' THEN 2
  WHEN ${taskTable.priority} = 'low' THEN 1
  ELSE 0
END`;

/**
 * List the pending tasks assigned to a given user within a single workspace,
 * grouped by project. Archived tasks and tasks in a final/done column are
 * excluded so the view reflects an actionable personal work queue.
 */
async function getMyTasks(workspaceId: string, userId: string) {
  // Restrict to projects the user can access (members only; global admins see
  // all). Without access to any project, the result is empty.
  const globalAdmin = await isGlobalAdmin(userId, workspaceId);
  const accessibleProjectIds = globalAdmin
    ? null
    : await getMemberProjectIds(userId, workspaceId);

  if (accessibleProjectIds && accessibleProjectIds.length === 0) {
    return { data: { workspaceId, total: 0, projects: [] } };
  }

  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      assigneeImage: userTable.image,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      projectIcon: projectTable.icon,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(
      columnTable,
      and(
        eq(columnTable.projectId, taskTable.projectId),
        eq(columnTable.slug, taskTable.status),
      ),
    )
    .where(
      and(
        eq(taskTable.userId, userId),
        eq(projectTable.workspaceId, workspaceId),
        ne(taskTable.status, "archived"),
        // Exclude tasks sitting in a final/done column. IS NOT TRUE also keeps
        // tasks whose status doesn't map to a column (NULL isFinal).
        sql`${columnTable.isFinal} IS NOT TRUE`,
        ...(accessibleProjectIds
          ? [inArray(taskTable.projectId, accessibleProjectIds)]
          : []),
      ),
    )
    .orderBy(
      desc(priorityCaseExpr),
      asc(taskTable.dueDate),
      asc(taskTable.position),
    );

  const taskIds = tasks.map((task) => task.id);

  const labelsData =
    taskIds.length > 0
      ? await db
          .select({
            id: labelTable.id,
            name: labelTable.name,
            color: labelTable.color,
            taskId: labelTable.taskId,
          })
          .from(labelTable)
          .where(inArray(labelTable.taskId, taskIds))
      : [];

  const labelsByTask = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (!label.taskId) continue;
    if (!labelsByTask.has(label.taskId)) {
      labelsByTask.set(label.taskId, []);
    }
    labelsByTask.get(label.taskId)?.push({
      id: label.id,
      name: label.name,
      color: label.color,
    });
  }

  type ProjectGroup = {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    tasks: Array<
      (typeof tasks)[number] & {
        labels: Array<{ id: string; name: string; color: string }>;
      }
    >;
  };

  const projectsMap = new Map<string, ProjectGroup>();
  for (const task of tasks) {
    let group = projectsMap.get(task.projectId);
    if (!group) {
      group = {
        id: task.projectId,
        name: task.projectName,
        slug: task.projectSlug,
        icon: task.projectIcon,
        tasks: [],
      };
      projectsMap.set(task.projectId, group);
    }
    group.tasks.push({
      ...task,
      labels: labelsByTask.get(task.id) || [],
    });
  }

  return {
    data: {
      workspaceId,
      total: tasks.length,
      projects: Array.from(projectsMap.values()),
    },
  };
}

export default getMyTasks;
