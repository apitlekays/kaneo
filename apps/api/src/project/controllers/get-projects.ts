import { and, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { getMemberProjectIds, isGlobalAdmin } from "../../utils/project-access";

async function getProjects(
  workspaceId: string,
  includeArchived = false,
  userId?: string,
) {
  const projects = await db.query.projectTable.findMany({
    where: includeArchived
      ? eq(projectTable.workspaceId, workspaceId)
      : and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.archivedAt),
        ),
    with: {
      tasks: true,
    },
  });

  // Per-project access: list every project (so non-members still see them in
  // the sidebar, locked), annotated with whether the current user can open it.
  const globalAdmin = userId ? await isGlobalAdmin(userId, workspaceId) : false;
  const memberProjectIds = new Set(
    userId && !globalAdmin
      ? await getMemberProjectIds(userId, workspaceId)
      : [],
  );
  const canAccess = (projectId: string) =>
    globalAdmin || memberProjectIds.has(projectId);

  const projectsWithStatistics = projects.map((project) => {
    const totalTasks = project.tasks.length;
    const completedTasks = project.tasks.filter(
      (task) => task.status === "done" || task.status === "archived",
    ).length;
    const completionPercentage =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const dueDate = project.tasks.reduce((earliest: Date | null, task) => {
      if (!earliest || (task.dueDate && task.dueDate < earliest))
        return task.dueDate;
      return earliest;
    }, null);

    return {
      ...project,
      isMember: canAccess(project.id),
      statistics: {
        completionPercentage,
        totalTasks,
        dueDate,
      },
      archivedTasks: [],
      plannedTasks: [],
      columns: [],
    };
  });

  return projectsWithStatistics;
}

export default getProjects;
