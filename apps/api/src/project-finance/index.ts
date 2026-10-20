import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  projectTable,
  taskCostTable,
  taskTable,
  userTable,
} from "../database/schema";
import {
  applyKeyPrefix,
  assertStorageConfigured,
  createTaskCostReceiptUploadUrl,
  deleteS3Object,
  getPrivateObject,
  taskCostReceiptKeyOwnerSegment,
} from "../storage/s3";
import {
  canAccessProject,
  canManageProjectMembers,
  canWriteProject,
} from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { broadcastToProject } from "../ws";

/**
 * A project's details ribbon (description, budget, revenue and the Actual
 * Expenditure tallied from its tasks' cost entries) and those cost entries.
 *
 * Money is in sen. Who may do what:
 *   - read anything: anyone who can open the project;
 *   - edit the ribbon, or anyone's cost entry: `canManageProjectMembers`
 *     (global admin, manager / Lead Consultant, or the creator);
 *   - add a cost entry, and edit or delete their own: anyone who can edit
 *     the project's tasks.
 */

type Env = { Variables: { userId: string; workspaceId?: string } };

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const RECEIPT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

/** Sen as a whole number: RM 0.01 up to RM 10 billion. */
const sen = v.pipe(v.number(), v.integer(), v.maxValue(1_000_000_000_000));
const positiveSen = v.pipe(sen, v.minValue(1, "Amount must be above RM 0"));
const day = v.pipe(v.string(), v.isoDate("Use a YYYY-MM-DD date"));

const receiptSchema = v.object({
  objectKey: v.string(),
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  mimeType: v.string(),
  size: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

/** A project's people, details, money and permissions changed. */
function announce(projectId: string) {
  broadcastToProject(projectId, { type: "PROJECT_DETAILS_UPDATED", projectId });
}

async function expenditureOf(projectId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${taskCostTable.amount}), 0)`,
    })
    .from(taskCostTable)
    .innerJoin(taskTable, eq(taskTable.id, taskCostTable.taskId))
    .where(eq(taskTable.projectId, projectId));
  // Postgres returns sum(bigint) as numeric text.
  return Number(row?.total ?? 0);
}

async function loadTask(taskId: string) {
  const [task] = await db
    .select({ id: taskTable.id, projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

function assertReceipt(
  receipt: v.InferOutput<typeof receiptSchema>,
  workspaceId: string,
  taskId: string,
) {
  const owner = applyKeyPrefix(
    assertStorageConfigured().keyPrefix,
    taskCostReceiptKeyOwnerSegment(workspaceId, taskId),
  );
  if (receipt.objectKey.includes("..") || !receipt.objectKey.startsWith(owner))
    throw new HTTPException(400, { message: "Invalid receipt" });
  if (!RECEIPT_TYPES.has(receipt.mimeType))
    throw new HTTPException(400, {
      message: "A receipt must be a PDF or an image",
    });
  if (receipt.size > MAX_RECEIPT_BYTES)
    throw new HTTPException(400, { message: "A receipt must be under 15MB" });
}

export const projectDetails = new Hono<Env>()
  .get(
    "/:projectId",
    describeRoute({
      operationId: "getProjectDetails",
      tags: ["Projects"],
      description:
        "A project's details ribbon: description, budget, revenue and the expenditure tallied from its tasks' costs",
    }),
    validator("param", v.object({ projectId: v.string() })),
    workspaceAccess.fromProject("projectId"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId") as string;
      if (!(await canAccessProject(userId, projectId, workspaceId)))
        throw new HTTPException(403, {
          message: "You don't have access to this project",
        });
      const [project] = await db
        .select({
          id: projectTable.id,
          kind: projectTable.kind,
          description: projectTable.description,
          budget: projectTable.budget,
          revenue: projectTable.revenue,
          createdBy: projectTable.createdBy,
        })
        .from(projectTable)
        .where(eq(projectTable.id, projectId))
        .limit(1);
      if (!project)
        throw new HTTPException(404, { message: "Project not found" });
      return c.json({
        ...project,
        expenditure: await expenditureOf(projectId),
        canEdit: await canManageProjectMembers(userId, projectId, workspaceId),
      });
    },
  )
  .put(
    "/:projectId",
    describeRoute({
      operationId: "updateProjectDetails",
      tags: ["Projects"],
      description: "Change a project's description, budget or revenue",
    }),
    validator("param", v.object({ projectId: v.string() })),
    validator(
      "json",
      v.object({
        description: v.optional(v.pipe(v.string(), v.maxLength(10_000))),
        budget: v.optional(v.nullable(sen)),
        revenue: v.optional(v.nullable(sen)),
      }),
    ),
    workspaceAccess.fromProject("projectId"),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId") as string;
      if (!(await canManageProjectMembers(userId, projectId, workspaceId)))
        throw new HTTPException(403, {
          message:
            "Only the creator, a manager or a global admin can edit these details",
        });
      const body = c.req.valid("json");
      const changes = Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(changes).length > 0)
        await db
          .update(projectTable)
          .set(changes)
          .where(eq(projectTable.id, projectId));
      announce(projectId);
      return c.json({ ok: true });
    },
  );

export const taskCosts = new Hono<Env>()
  .get(
    "/task/:taskId",
    describeRoute({
      operationId: "listTaskCosts",
      tags: ["Tasks"],
      description: "A task's cost entries, newest first",
    }),
    validator("param", v.object({ taskId: v.string() })),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId") as string;
      const task = await loadTask(taskId);
      if (!(await canAccessProject(userId, task.projectId, workspaceId)))
        throw new HTTPException(403, {
          message: "You don't have access to this task",
        });
      const rows = await db
        .select({
          id: taskCostTable.id,
          description: taskCostTable.description,
          amount: taskCostTable.amount,
          incurredOn: taskCostTable.incurredOn,
          receiptFilename: taskCostTable.receiptFilename,
          receiptMimeType: taskCostTable.receiptMimeType,
          createdBy: taskCostTable.createdBy,
          createdByName: userTable.name,
          createdAt: taskCostTable.createdAt,
        })
        .from(taskCostTable)
        .leftJoin(userTable, eq(userTable.id, taskCostTable.createdBy))
        .where(eq(taskCostTable.taskId, taskId))
        .orderBy(asc(taskCostTable.incurredOn), asc(taskCostTable.createdAt));
      const [canWrite, canManage] = await Promise.all([
        canWriteProject(userId, task.projectId, workspaceId),
        canManageProjectMembers(userId, task.projectId, workspaceId),
      ]);
      return c.json({
        canAdd: canWrite,
        items: rows.map((row) => ({
          ...row,
          canEdit: canManage || (canWrite && row.createdBy === userId),
        })),
      });
    },
  )
  .post(
    "/task/:taskId/receipt/presign",
    describeRoute({
      operationId: "presignTaskCostReceipt",
      tags: ["Tasks"],
      description: "A presigned upload URL for a cost entry's receipt",
    }),
    validator("param", v.object({ taskId: v.string() })),
    validator(
      "json",
      v.object({
        filename: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
        mimeType: v.string(),
        size: v.pipe(v.number(), v.integer(), v.minValue(1)),
      }),
    ),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId") as string;
      const task = await loadTask(taskId);
      if (!(await canWriteProject(userId, task.projectId, workspaceId)))
        throw new HTTPException(403, {
          message: "You can't add costs to this task",
        });
      const { filename, mimeType, size } = c.req.valid("json");
      if (!RECEIPT_TYPES.has(mimeType))
        throw new HTTPException(400, {
          message: "A receipt must be a PDF or an image",
        });
      if (size > MAX_RECEIPT_BYTES)
        throw new HTTPException(400, {
          message: "A receipt must be under 15MB",
        });
      return c.json(
        await createTaskCostReceiptUploadUrl({
          workspaceId,
          taskId,
          filename,
          contentType: mimeType,
        }),
      );
    },
  )
  .post(
    "/task/:taskId",
    describeRoute({
      operationId: "createTaskCost",
      tags: ["Tasks"],
      description: "Record a cost incurred on a task",
    }),
    validator("param", v.object({ taskId: v.string() })),
    validator(
      "json",
      v.object({
        description: v.pipe(
          v.string(),
          v.trim(),
          v.minLength(1),
          v.maxLength(500),
        ),
        amount: positiveSen,
        incurredOn: day,
        receipt: v.optional(receiptSchema),
      }),
    ),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const userId = c.get("userId");
      const workspaceId = c.get("workspaceId") as string;
      const task = await loadTask(taskId);
      if (!(await canWriteProject(userId, task.projectId, workspaceId)))
        throw new HTTPException(403, {
          message: "You can't add costs to this task",
        });
      const body = c.req.valid("json");
      if (body.receipt) assertReceipt(body.receipt, workspaceId, taskId);
      const [created] = await db
        .insert(taskCostTable)
        .values({
          taskId,
          description: body.description,
          amount: body.amount,
          incurredOn: new Date(`${body.incurredOn}T00:00:00Z`),
          receiptKey: body.receipt?.objectKey ?? null,
          receiptFilename: body.receipt?.filename ?? null,
          receiptMimeType: body.receipt?.mimeType ?? null,
          receiptSize: body.receipt?.size ?? null,
          createdBy: userId,
        })
        .returning({ id: taskCostTable.id });
      announce(task.projectId);
      return c.json(created, 201);
    },
  )
  .put(
    "/task/:taskId/:costId",
    describeRoute({
      operationId: "updateTaskCost",
      tags: ["Tasks"],
      description: "Change a cost entry; `receipt: null` removes its receipt",
    }),
    validator("param", v.object({ taskId: v.string(), costId: v.string() })),
    validator(
      "json",
      v.object({
        description: v.optional(
          v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
        ),
        amount: v.optional(positiveSen),
        incurredOn: v.optional(day),
        receipt: v.optional(v.nullable(receiptSchema)),
      }),
    ),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId, costId } = c.req.valid("param");
      const workspaceId = c.get("workspaceId") as string;
      const { task, cost } = await loadEditableCost(
        c.get("userId"),
        workspaceId,
        taskId,
        costId,
      );
      const body = c.req.valid("json");
      if (body.receipt) assertReceipt(body.receipt, workspaceId, taskId);
      await db
        .update(taskCostTable)
        .set({
          ...(body.description !== undefined && {
            description: body.description,
          }),
          ...(body.amount !== undefined && { amount: body.amount }),
          ...(body.incurredOn !== undefined && {
            incurredOn: new Date(`${body.incurredOn}T00:00:00Z`),
          }),
          ...(body.receipt !== undefined && {
            receiptKey: body.receipt?.objectKey ?? null,
            receiptFilename: body.receipt?.filename ?? null,
            receiptMimeType: body.receipt?.mimeType ?? null,
            receiptSize: body.receipt?.size ?? null,
          }),
        })
        .where(eq(taskCostTable.id, costId));
      // A replaced or removed receipt is no longer referenced.
      if (
        body.receipt !== undefined &&
        cost.receiptKey &&
        cost.receiptKey !== body.receipt?.objectKey
      )
        await deleteS3Object(cost.receiptKey).catch(() => {});
      announce(task.projectId);
      return c.json({ ok: true });
    },
  )
  .delete(
    "/task/:taskId/:costId",
    describeRoute({
      operationId: "deleteTaskCost",
      tags: ["Tasks"],
      description: "Delete a cost entry and its receipt",
    }),
    validator("param", v.object({ taskId: v.string(), costId: v.string() })),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId, costId } = c.req.valid("param");
      const { task, cost } = await loadEditableCost(
        c.get("userId"),
        c.get("workspaceId") as string,
        taskId,
        costId,
      );
      await db.delete(taskCostTable).where(eq(taskCostTable.id, costId));
      if (cost.receiptKey)
        await deleteS3Object(cost.receiptKey).catch(() => {});
      announce(task.projectId);
      return c.json({ ok: true });
    },
  )
  .get(
    "/task/:taskId/:costId/receipt",
    describeRoute({
      operationId: "downloadTaskCostReceipt",
      tags: ["Tasks"],
      description: "Download a cost entry's receipt",
    }),
    validator("param", v.object({ taskId: v.string(), costId: v.string() })),
    workspaceAccess.fromTask("taskId"),
    async (c) => {
      const { taskId, costId } = c.req.valid("param");
      const userId = c.get("userId");
      const task = await loadTask(taskId);
      if (
        !(await canAccessProject(
          userId,
          task.projectId,
          c.get("workspaceId") as string,
        ))
      )
        throw new HTTPException(403, {
          message: "You don't have access to this task",
        });
      const [cost] = await db
        .select()
        .from(taskCostTable)
        .where(
          and(eq(taskCostTable.id, costId), eq(taskCostTable.taskId, taskId)),
        )
        .limit(1);
      if (!cost?.receiptKey)
        throw new HTTPException(404, { message: "No receipt" });
      try {
        const object = await getPrivateObject(cost.receiptKey);
        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Type": cost.receiptMimeType ?? "application/octet-stream",
            "Content-Disposition": `inline; filename="${encodeURIComponent(cost.receiptFilename ?? "receipt")}"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        throw new HTTPException(404, { message: "Receipt not found" });
      }
    },
  );

/** The entry, if this user may change it: its author or a project runner. */
async function loadEditableCost(
  userId: string,
  workspaceId: string,
  taskId: string,
  costId: string,
) {
  const task = await loadTask(taskId);
  const [cost] = await db
    .select()
    .from(taskCostTable)
    .where(and(eq(taskCostTable.id, costId), eq(taskCostTable.taskId, taskId)))
    .limit(1);
  if (!cost) throw new HTTPException(404, { message: "Cost entry not found" });
  const allowed =
    (await canManageProjectMembers(userId, task.projectId, workspaceId)) ||
    (cost.createdBy === userId &&
      (await canWriteProject(userId, task.projectId, workspaceId)));
  if (!allowed)
    throw new HTTPException(403, {
      message:
        "Only whoever recorded this cost, a manager, the creator or a global admin can change it",
    });
  return { task, cost };
}
