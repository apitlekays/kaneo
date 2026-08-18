import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../../../apps/api/src/project/controllers/create-project";

export type SeededMemberContext = {
  user: typeof schema.userTable.$inferSelect;
  workspace: typeof schema.workspaceTable.$inferSelect;
};

export async function createWorkspaceMember(
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
  }>,
): Promise<SeededMemberContext> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;

  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: overrides?.userName || "Integration Test User",
    })
    .returning();

  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: workspaceId,
      createdAt: new Date(),
      name: overrides?.workspaceName || "Integration Test Workspace",
      slug: `workspace-${randomUUID()}`,
    })
    .returning();

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: overrides?.role ?? "member",
    joinedAt: new Date(),
  });

  return { user, workspace };
}

export async function createProjectFixture({
  workspaceId,
  name = "Integration Project",
  icon = "Folder",
  slug = `project-${randomUUID()}`,
  memberUserId,
  memberRole = "member",
}: {
  workspaceId: string;
  name?: string;
  icon?: string;
  slug?: string;
  /**
   * Join this user to the project. Task routes run `requireProjectAccess`
   * before the RBAC check, so a workspace member with `task:create` is still
   * refused until they hold a project role.
   */
  memberUserId?: string;
  memberRole?: string;
}) {
  const [project] = await db
    .insert(schema.projectTable)
    .values({
      workspaceId,
      name,
      icon,
      slug,
    })
    .returning();

  if (memberUserId) {
    await db.insert(schema.projectMemberTable).values({
      projectId: project.id,
      userId: memberUserId,
      role: memberRole,
    });
  }

  const insertedColumns: (typeof schema.columnTable.$inferSelect)[] = [];

  for (const col of DEFAULT_PROJECT_COLUMNS) {
    const [inserted] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: col.name,
        slug: col.slug,
        position: col.position,
        isFinal: col.isFinal,
      })
      .returning();
    if (inserted) {
      insertedColumns.push(inserted);
    }
  }

  const columnsBySlug = new Map(
    insertedColumns.map((column) => [column.slug, column]),
  );

  const todo = columnsBySlug.get("to-do");
  const inProgress = columnsBySlug.get("in-progress");
  const inReview = columnsBySlug.get("in-review");
  const done = columnsBySlug.get("done");

  if (!todo || !inProgress || !inReview || !done) {
    throw new Error("Failed to seed default project columns");
  }

  return {
    project,
    columns: {
      todo,
      inProgress,
      inReview,
      done,
    },
  };
}

/**
 * Correspondence routes run requireWorkspacePageAccess("general-management").
 * A plain member is refused, so grant the page explicitly.
 */
export async function grantGeneralManagement(
  workspaceId: string,
  userId: string,
) {
  await db.insert(schema.workspacePageAccessTable).values({
    workspaceId,
    userId,
    pageSlug: "general-management",
  });
}
