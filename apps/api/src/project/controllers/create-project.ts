import db from "../../database";
import {
  columnTable,
  projectMemberTable,
  projectTable,
} from "../../database/schema";

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  createdBy?: string,
) {
  return db.transaction(async (tx) => {
    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        createdBy: createdBy ?? null,
      })
      .returning();

    if (createdProject) {
      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          isFinal: col.isFinal,
        });
      }

      // The creator becomes the project's first member (a manager).
      if (createdBy) {
        await tx.insert(projectMemberTable).values({
          projectId: createdProject.id,
          userId: createdBy,
          role: "manager",
        });
      }
    }

    return createdProject;
  });
}

export default createProject;
