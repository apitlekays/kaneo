import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import { taskMomTable, taskTable, userTable } from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import {
  requireProjectAccess,
  requireProjectAccessFromTask,
} from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const personSchema = v.object({
  id: v.string(),
  userId: v.nullable(v.string()),
  name: v.string(),
});

const rowSchema = v.object({
  id: v.string(),
  agenda: v.string(),
  discussion: v.string(),
  action: v.string(),
  taggedUserIds: v.array(v.string()),
  subtaskId: v.optional(v.nullable(v.string())),
});

const momDataSchema = v.object({
  date: v.nullable(v.string()),
  time: v.nullable(v.string()),
  attendees: v.array(personSchema),
  absentees: v.array(personSchema),
  rows: v.array(rowSchema),
  locked: v.optional(v.boolean()),
});

type MomData = v.InferOutput<typeof momDataSchema>;

function collectTaggedUserIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  const rows = (data as { rows?: { taggedUserIds?: string[] }[] })?.rows ?? [];
  for (const row of rows) {
    for (const uid of row.taggedUserIds ?? []) ids.add(uid);
  }
  return ids;
}

const taskMom = new Hono<{
  Variables: { userId: string; workspaceId?: string };
}>()
  // Consolidated list of every meeting's minutes in a project (the Minutes view).
  .get(
    "/project/:projectId",
    validator("param", v.object({ projectId: v.string() })),
    workspaceAccess.fromProject("projectId"),
    requireProjectAccess("projectId"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const rows = await db
        .select({
          taskId: taskMomTable.taskId,
          data: taskMomTable.data,
          updatedAt: taskMomTable.updatedAt,
          taskTitle: taskTable.title,
          taskNumber: taskTable.number,
          taskStatus: taskTable.status,
        })
        .from(taskMomTable)
        .innerJoin(taskTable, eq(taskMomTable.taskId, taskTable.id))
        .where(eq(taskTable.projectId, projectId))
        .orderBy(desc(taskMomTable.updatedAt));
      return c.json(rows);
    },
  )
  .get(
    "/:taskId",
    validator("param", v.object({ taskId: v.string() })),
    workspaceAccess.fromTaskId("taskId"),
    requireProjectAccessFromTask("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const [row] = await db
        .select()
        .from(taskMomTable)
        .where(eq(taskMomTable.taskId, taskId))
        .limit(1);
      return c.json(row ?? null);
    },
  )
  .put(
    "/:taskId",
    validator("param", v.object({ taskId: v.string() })),
    validator("json", v.object({ data: momDataSchema })),
    workspaceAccess.fromTaskId("taskId"),
    requireProjectAccessFromTask("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { data } = c.req.valid("json") as { data: MomData };
      const userId = c.get("userId");

      const [existing] = await db
        .select()
        .from(taskMomTable)
        .where(eq(taskMomTable.taskId, taskId))
        .limit(1);

      const oldTagged = existing
        ? collectTaggedUserIds(existing.data)
        : new Set<string>();
      const newTagged = collectTaggedUserIds(data);

      const [row] = existing
        ? await db
            .update(taskMomTable)
            .set({ data, updatedBy: userId, updatedAt: new Date() })
            .where(eq(taskMomTable.taskId, taskId))
            .returning()
        : await db
            .insert(taskMomTable)
            .values({ taskId, data, updatedBy: userId })
            .returning();

      // Notify users newly tagged in an action item (not previously tagged and
      // not the person doing the tagging).
      const newlyTagged = [...newTagged].filter(
        (uid) => !oldTagged.has(uid) && uid !== userId,
      );
      if (newlyTagged.length > 0) {
        const [actor] = await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, userId))
          .limit(1);
        const [task] = await db
          .select({ title: taskTable.title })
          .from(taskTable)
          .where(eq(taskTable.id, taskId))
          .limit(1);

        await Promise.all(
          newlyTagged.map((uid) =>
            createNotification({
              userId: uid,
              type: "task_tagged",
              eventData: {
                actorName: actor?.name ?? "Someone",
                taskTitle: task?.title ?? "",
              },
              resourceId: taskId,
              resourceType: "task",
            }),
          ),
        );
      }

      return c.json(row);
    },
  );

export default taskMom;
