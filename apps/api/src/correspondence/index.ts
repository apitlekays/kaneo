import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  gmApprovalChainTable,
  gmApprovalStepTable,
  gmCategoryTable,
  gmDepartmentTable,
  gmDistributionListTable,
  gmFilePlanNodeTable,
  gmNumberSchemeTable,
  gmRetentionClassTable,
  gmSecurityLabelTable,
  gmSenderProfileTable,
  gmSignatoryTable,
  gmSlaPolicyTable,
  gmTemplateTable,
} from "../database/schema";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { recordAuditEvent, verifyAuditChain } from "./audit";
import { assertGmAdmin } from "./roles";

const PAGE_SLUG = "general-management";
const pageAccess = requireWorkspacePageAccess(PAGE_SLUG);

// Context variables populated by the auth + workspace-access middleware.
type GmEnv = { Variables: { userId: string; workspaceId?: string } };

// The root db and a transaction share these methods; concrete-table drizzle
// calls typecheck against this (unlike a bare generic `PgTable`).
type Tx = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute"
>;
type Row = Record<string, unknown>;

const optStr = v.optional(v.string());
const optBool = v.optional(v.boolean());
const optNum = v.optional(v.number());
const optRec = v.optional(v.record(v.string(), v.unknown()));

function getIp(c: Context) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

/** Copy only the defined keys from a request body into a typed update patch. */
function patch<T extends Row>(
  body: Row,
  keys: (keyof T & string)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key] as T[keyof T & string];
  }
  return out;
}

/**
 * A config resource's data operations. The concrete drizzle calls live here
 * (fully typed) while the registrar owns routing, validation, GM-admin gating,
 * transactions, and the audit trail. "Delete" is a soft deactivate.
 */
type ConfigResource = {
  path: string;
  entityType: string;
  createSchema: v.GenericSchema;
  updateSchema: v.GenericSchema;
  list: (workspaceId: string, includeInactive: boolean) => Promise<unknown[]>;
  create: (tx: Tx, workspaceId: string, body: Row) => Promise<Row>;
  update: (
    tx: Tx,
    workspaceId: string,
    id: string,
    body: Row,
  ) => Promise<{ before: Row; after: Row } | null>;
  deactivate: (
    tx: Tx,
    workspaceId: string,
    id: string,
  ) => Promise<{ before: Row; after: Row } | null>;
};

function registerConfigResource(app: Hono<GmEnv>, def: ConfigResource) {
  const base = `/config/${def.path}`;

  // Fluent chain (not discrete statements) so Hono's route overloads resolve.
  app
    .get(
      base,
      validator(
        "query",
        v.object({ workspaceId: v.string(), includeInactive: optStr }),
      ),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const includeInactive = c.req.valid("query").includeInactive === "true";
        return c.json(await def.list(ws, includeInactive));
      },
    )
    .post(
      base,
      validator("json", def.createSchema),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const body = c.req.valid("json") as Row;
        const created = await db.transaction(async (tx) => {
          const row = await def.create(tx, ws, body);
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: def.entityType,
            entityId: String(row.id),
            action: "create",
            actorId: userId,
            after: row,
            ip: getIp(c),
          });
          return row;
        });
        return c.json(created, 201);
      },
    )
    .put(
      `${base}/:id`,
      validator("param", v.object({ id: v.string() })),
      validator("json", def.updateSchema),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const { id } = c.req.valid("param");
        const body = c.req.valid("json") as Row;
        const result = await db.transaction(async (tx) => {
          const res = await def.update(tx, ws, id, body);
          if (!res) return null;
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: def.entityType,
            entityId: id,
            action: "update",
            actorId: userId,
            before: res.before,
            after: res.after,
            ip: getIp(c),
          });
          return res.after;
        });
        if (!result) throw new HTTPException(404, { message: "Not found" });
        return c.json(result);
      },
    )
    .delete(
      `${base}/:id`,
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const { id } = c.req.valid("param");
        const ok = await db.transaction(async (tx) => {
          const res = await def.deactivate(tx, ws, id);
          if (!res) return false;
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: def.entityType,
            entityId: id,
            action: "deactivate",
            actorId: userId,
            before: res.before,
            after: res.after,
            ip: getIp(c),
          });
          return true;
        });
        if (!ok) throw new HTTPException(404, { message: "Not found" });
        return c.json({ success: true });
      },
    );
}

const app = new Hono<GmEnv>();

// ── gm_category ──────────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "categories",
  entityType: "gm_category",
  createSchema: v.object({
    workspaceId: v.string(),
    key: v.string(),
    label: v.string(),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    key: optStr,
    label: optStr,
    active: optBool,
  }),
  list: (ws, includeInactive) =>
    db
      .select()
      .from(gmCategoryTable)
      .where(
        includeInactive
          ? eq(gmCategoryTable.workspaceId, ws)
          : and(
              eq(gmCategoryTable.workspaceId, ws),
              eq(gmCategoryTable.active, true),
            ),
      )
      .orderBy(asc(gmCategoryTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmCategoryTable)
      .values({
        workspaceId: ws,
        key: b.key as string,
        label: b.label as string,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmCategoryTable)
      .where(
        and(eq(gmCategoryTable.id, id), eq(gmCategoryTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmCategoryTable)
      .set(
        patch<typeof gmCategoryTable.$inferInsert>(b, [
          "key",
          "label",
          "active",
        ]),
      )
      .where(
        and(eq(gmCategoryTable.id, id), eq(gmCategoryTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmCategoryTable)
      .where(
        and(eq(gmCategoryTable.id, id), eq(gmCategoryTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmCategoryTable)
      .set({ active: false })
      .where(
        and(eq(gmCategoryTable.id, id), eq(gmCategoryTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_security_label ────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "security-labels",
  entityType: "gm_security_label",
  createSchema: v.object({
    workspaceId: v.string(),
    key: v.string(),
    label: v.string(),
    rank: optNum,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    key: optStr,
    label: optStr,
    rank: optNum,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmSecurityLabelTable)
      .where(
        inc
          ? eq(gmSecurityLabelTable.workspaceId, ws)
          : and(
              eq(gmSecurityLabelTable.workspaceId, ws),
              eq(gmSecurityLabelTable.active, true),
            ),
      )
      .orderBy(asc(gmSecurityLabelTable.rank)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmSecurityLabelTable)
      .values({
        workspaceId: ws,
        key: b.key as string,
        label: b.label as string,
        rank: (b.rank as number | undefined) ?? 0,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmSecurityLabelTable)
      .where(
        and(
          eq(gmSecurityLabelTable.id, id),
          eq(gmSecurityLabelTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSecurityLabelTable)
      .set(
        patch<typeof gmSecurityLabelTable.$inferInsert>(b, [
          "key",
          "label",
          "rank",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmSecurityLabelTable.id, id),
          eq(gmSecurityLabelTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmSecurityLabelTable)
      .where(
        and(
          eq(gmSecurityLabelTable.id, id),
          eq(gmSecurityLabelTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSecurityLabelTable)
      .set({ active: false })
      .where(
        and(
          eq(gmSecurityLabelTable.id, id),
          eq(gmSecurityLabelTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_file_plan_node ────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "file-plan",
  entityType: "gm_file_plan_node",
  createSchema: v.object({
    workspaceId: v.string(),
    parentId: optStr,
    code: optStr,
    name: v.string(),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    parentId: optStr,
    code: optStr,
    name: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmFilePlanNodeTable)
      .where(
        inc
          ? eq(gmFilePlanNodeTable.workspaceId, ws)
          : and(
              eq(gmFilePlanNodeTable.workspaceId, ws),
              eq(gmFilePlanNodeTable.active, true),
            ),
      )
      .orderBy(asc(gmFilePlanNodeTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmFilePlanNodeTable)
      .values({
        workspaceId: ws,
        parentId: (b.parentId as string | undefined) ?? null,
        code: (b.code as string | undefined) ?? null,
        name: b.name as string,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmFilePlanNodeTable)
      .where(
        and(
          eq(gmFilePlanNodeTable.id, id),
          eq(gmFilePlanNodeTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmFilePlanNodeTable)
      .set(
        patch<typeof gmFilePlanNodeTable.$inferInsert>(b, [
          "parentId",
          "code",
          "name",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmFilePlanNodeTable.id, id),
          eq(gmFilePlanNodeTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmFilePlanNodeTable)
      .where(
        and(
          eq(gmFilePlanNodeTable.id, id),
          eq(gmFilePlanNodeTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmFilePlanNodeTable)
      .set({ active: false })
      .where(
        and(
          eq(gmFilePlanNodeTable.id, id),
          eq(gmFilePlanNodeTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_number_scheme ─────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "number-schemes",
  entityType: "gm_number_scheme",
  createSchema: v.object({
    workspaceId: v.string(),
    key: v.string(),
    label: v.string(),
    direction: v.picklist(["in", "out"]),
    letterType: v.picklist(["external", "memo", "circular"]),
    format: optRec,
    resetPolicy: v.optional(v.picklist(["yearly", "never"])),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    key: optStr,
    label: optStr,
    direction: v.optional(v.picklist(["in", "out"])),
    letterType: v.optional(v.picklist(["external", "memo", "circular"])),
    format: optRec,
    resetPolicy: v.optional(v.picklist(["yearly", "never"])),
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmNumberSchemeTable)
      .where(
        inc
          ? eq(gmNumberSchemeTable.workspaceId, ws)
          : and(
              eq(gmNumberSchemeTable.workspaceId, ws),
              eq(gmNumberSchemeTable.active, true),
            ),
      )
      .orderBy(asc(gmNumberSchemeTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmNumberSchemeTable)
      .values({
        workspaceId: ws,
        key: b.key as string,
        label: b.label as string,
        direction: b.direction as string,
        letterType: b.letterType as string,
        format: (b.format as Row | undefined) ?? {},
        resetPolicy: (b.resetPolicy as string | undefined) ?? "yearly",
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmNumberSchemeTable)
      .where(
        and(
          eq(gmNumberSchemeTable.id, id),
          eq(gmNumberSchemeTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmNumberSchemeTable)
      .set(
        patch<typeof gmNumberSchemeTable.$inferInsert>(b, [
          "key",
          "label",
          "direction",
          "letterType",
          "format",
          "resetPolicy",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmNumberSchemeTable.id, id),
          eq(gmNumberSchemeTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmNumberSchemeTable)
      .where(
        and(
          eq(gmNumberSchemeTable.id, id),
          eq(gmNumberSchemeTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmNumberSchemeTable)
      .set({ active: false })
      .where(
        and(
          eq(gmNumberSchemeTable.id, id),
          eq(gmNumberSchemeTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_distribution_list ─────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "distribution-lists",
  entityType: "gm_distribution_list",
  createSchema: v.object({
    workspaceId: v.string(),
    name: v.string(),
    groupEmail: v.pipe(v.string(), v.email()),
    description: optStr,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    name: optStr,
    groupEmail: v.optional(v.pipe(v.string(), v.email())),
    description: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmDistributionListTable)
      .where(
        inc
          ? eq(gmDistributionListTable.workspaceId, ws)
          : and(
              eq(gmDistributionListTable.workspaceId, ws),
              eq(gmDistributionListTable.active, true),
            ),
      )
      .orderBy(asc(gmDistributionListTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmDistributionListTable)
      .values({
        workspaceId: ws,
        name: b.name as string,
        groupEmail: b.groupEmail as string,
        description: (b.description as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmDistributionListTable)
      .where(
        and(
          eq(gmDistributionListTable.id, id),
          eq(gmDistributionListTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmDistributionListTable)
      .set(
        patch<typeof gmDistributionListTable.$inferInsert>(b, [
          "name",
          "groupEmail",
          "description",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmDistributionListTable.id, id),
          eq(gmDistributionListTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmDistributionListTable)
      .where(
        and(
          eq(gmDistributionListTable.id, id),
          eq(gmDistributionListTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmDistributionListTable)
      .set({ active: false })
      .where(
        and(
          eq(gmDistributionListTable.id, id),
          eq(gmDistributionListTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_sender_profile ────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "sender-profiles",
  entityType: "gm_sender_profile",
  createSchema: v.object({
    workspaceId: v.string(),
    displayName: v.string(),
    replyTo: v.optional(v.pipe(v.string(), v.email())),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    displayName: optStr,
    replyTo: v.optional(v.pipe(v.string(), v.email())),
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmSenderProfileTable)
      .where(
        inc
          ? eq(gmSenderProfileTable.workspaceId, ws)
          : and(
              eq(gmSenderProfileTable.workspaceId, ws),
              eq(gmSenderProfileTable.active, true),
            ),
      )
      .orderBy(asc(gmSenderProfileTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmSenderProfileTable)
      .values({
        workspaceId: ws,
        displayName: b.displayName as string,
        replyTo: (b.replyTo as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmSenderProfileTable)
      .where(
        and(
          eq(gmSenderProfileTable.id, id),
          eq(gmSenderProfileTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSenderProfileTable)
      .set(
        patch<typeof gmSenderProfileTable.$inferInsert>(b, [
          "displayName",
          "replyTo",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmSenderProfileTable.id, id),
          eq(gmSenderProfileTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmSenderProfileTable)
      .where(
        and(
          eq(gmSenderProfileTable.id, id),
          eq(gmSenderProfileTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSenderProfileTable)
      .set({ active: false })
      .where(
        and(
          eq(gmSenderProfileTable.id, id),
          eq(gmSenderProfileTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_retention_class ───────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "retention-classes",
  entityType: "gm_retention_class",
  createSchema: v.object({
    workspaceId: v.string(),
    name: v.string(),
    retentionMonths: v.pipe(v.number(), v.integer(), v.minValue(0)),
    trigger: v.optional(v.picklist(["close", "fy-end"])),
    dispositionAction: v.optional(
      v.picklist(["destroy", "transfer", "permanent", "review"]),
    ),
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    name: optStr,
    retentionMonths: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    trigger: v.optional(v.picklist(["close", "fy-end"])),
    dispositionAction: v.optional(
      v.picklist(["destroy", "transfer", "permanent", "review"]),
    ),
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmRetentionClassTable)
      .where(
        inc
          ? eq(gmRetentionClassTable.workspaceId, ws)
          : and(
              eq(gmRetentionClassTable.workspaceId, ws),
              eq(gmRetentionClassTable.active, true),
            ),
      )
      .orderBy(asc(gmRetentionClassTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmRetentionClassTable)
      .values({
        workspaceId: ws,
        name: b.name as string,
        retentionMonths: b.retentionMonths as number,
        trigger: (b.trigger as string | undefined) ?? "close",
        dispositionAction:
          (b.dispositionAction as string | undefined) ?? "review",
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmRetentionClassTable)
      .where(
        and(
          eq(gmRetentionClassTable.id, id),
          eq(gmRetentionClassTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmRetentionClassTable)
      .set(
        patch<typeof gmRetentionClassTable.$inferInsert>(b, [
          "name",
          "retentionMonths",
          "trigger",
          "dispositionAction",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmRetentionClassTable.id, id),
          eq(gmRetentionClassTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmRetentionClassTable)
      .where(
        and(
          eq(gmRetentionClassTable.id, id),
          eq(gmRetentionClassTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmRetentionClassTable)
      .set({ active: false })
      .where(
        and(
          eq(gmRetentionClassTable.id, id),
          eq(gmRetentionClassTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_sla_policy ────────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "sla-policies",
  entityType: "gm_sla_policy",
  createSchema: v.object({
    workspaceId: v.string(),
    name: v.string(),
    appliesTo: optRec,
    ackHours: optNum,
    actionHours: optNum,
    approvalHours: optNum,
    escalateToRole: optStr,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    name: optStr,
    appliesTo: optRec,
    ackHours: optNum,
    actionHours: optNum,
    approvalHours: optNum,
    escalateToRole: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmSlaPolicyTable)
      .where(
        inc
          ? eq(gmSlaPolicyTable.workspaceId, ws)
          : and(
              eq(gmSlaPolicyTable.workspaceId, ws),
              eq(gmSlaPolicyTable.active, true),
            ),
      )
      .orderBy(asc(gmSlaPolicyTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmSlaPolicyTable)
      .values({
        workspaceId: ws,
        name: b.name as string,
        appliesTo: (b.appliesTo as Row | undefined) ?? null,
        ackHours: (b.ackHours as number | undefined) ?? null,
        actionHours: (b.actionHours as number | undefined) ?? null,
        approvalHours: (b.approvalHours as number | undefined) ?? null,
        escalateToRole: (b.escalateToRole as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmSlaPolicyTable)
      .where(
        and(eq(gmSlaPolicyTable.id, id), eq(gmSlaPolicyTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSlaPolicyTable)
      .set(
        patch<typeof gmSlaPolicyTable.$inferInsert>(b, [
          "name",
          "appliesTo",
          "ackHours",
          "actionHours",
          "approvalHours",
          "escalateToRole",
          "active",
        ]),
      )
      .where(
        and(eq(gmSlaPolicyTable.id, id), eq(gmSlaPolicyTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmSlaPolicyTable)
      .where(
        and(eq(gmSlaPolicyTable.id, id), eq(gmSlaPolicyTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSlaPolicyTable)
      .set({ active: false })
      .where(
        and(eq(gmSlaPolicyTable.id, id), eq(gmSlaPolicyTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_signatory ─────────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "signatories",
  entityType: "gm_signatory",
  createSchema: v.object({
    workspaceId: v.string(),
    userId: v.string(),
    appliesToType: optRec,
    signatureImageKey: optStr,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    appliesToType: optRec,
    signatureImageKey: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmSignatoryTable)
      .where(
        inc
          ? eq(gmSignatoryTable.workspaceId, ws)
          : and(
              eq(gmSignatoryTable.workspaceId, ws),
              eq(gmSignatoryTable.active, true),
            ),
      )
      .orderBy(asc(gmSignatoryTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmSignatoryTable)
      .values({
        workspaceId: ws,
        userId: b.userId as string,
        appliesToType: (b.appliesToType as Row | undefined) ?? null,
        signatureImageKey: (b.signatureImageKey as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmSignatoryTable)
      .where(
        and(eq(gmSignatoryTable.id, id), eq(gmSignatoryTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSignatoryTable)
      .set(
        patch<typeof gmSignatoryTable.$inferInsert>(b, [
          "appliesToType",
          "signatureImageKey",
          "active",
        ]),
      )
      .where(
        and(eq(gmSignatoryTable.id, id), eq(gmSignatoryTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmSignatoryTable)
      .where(
        and(eq(gmSignatoryTable.id, id), eq(gmSignatoryTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmSignatoryTable)
      .set({ active: false })
      .where(
        and(eq(gmSignatoryTable.id, id), eq(gmSignatoryTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_template ──────────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "templates",
  entityType: "gm_template",
  createSchema: v.object({
    workspaceId: v.string(),
    letterType: v.picklist(["external", "memo", "circular"]),
    name: v.string(),
    lang: v.optional(v.picklist(["bm", "en"])),
    bodyHtml: optStr,
    letterheadObjectKey: optStr,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    letterType: v.optional(v.picklist(["external", "memo", "circular"])),
    name: optStr,
    lang: v.optional(v.picklist(["bm", "en"])),
    bodyHtml: optStr,
    letterheadObjectKey: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmTemplateTable)
      .where(
        inc
          ? eq(gmTemplateTable.workspaceId, ws)
          : and(
              eq(gmTemplateTable.workspaceId, ws),
              eq(gmTemplateTable.active, true),
            ),
      )
      .orderBy(asc(gmTemplateTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmTemplateTable)
      .values({
        workspaceId: ws,
        letterType: b.letterType as string,
        name: b.name as string,
        lang: (b.lang as string | undefined) ?? "en",
        bodyHtml: (b.bodyHtml as string | undefined) ?? "",
        letterheadObjectKey:
          (b.letterheadObjectKey as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmTemplateTable)
      .where(
        and(eq(gmTemplateTable.id, id), eq(gmTemplateTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmTemplateTable)
      .set(
        patch<typeof gmTemplateTable.$inferInsert>(b, [
          "letterType",
          "name",
          "lang",
          "bodyHtml",
          "letterheadObjectKey",
          "active",
        ]),
      )
      .where(
        and(eq(gmTemplateTable.id, id), eq(gmTemplateTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmTemplateTable)
      .where(
        and(eq(gmTemplateTable.id, id), eq(gmTemplateTable.workspaceId, ws)),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmTemplateTable)
      .set({ active: false })
      .where(
        and(eq(gmTemplateTable.id, id), eq(gmTemplateTable.workspaceId, ws)),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── gm_department ────────────────────────────────────────────────────────────
registerConfigResource(app, {
  path: "departments",
  entityType: "gm_department",
  createSchema: v.object({
    workspaceId: v.string(),
    name: v.string(),
    parentId: optStr,
    headUserId: optStr,
    active: optBool,
  }),
  updateSchema: v.object({
    workspaceId: v.string(),
    name: optStr,
    parentId: optStr,
    headUserId: optStr,
    active: optBool,
  }),
  list: (ws, inc) =>
    db
      .select()
      .from(gmDepartmentTable)
      .where(
        inc
          ? eq(gmDepartmentTable.workspaceId, ws)
          : and(
              eq(gmDepartmentTable.workspaceId, ws),
              eq(gmDepartmentTable.active, true),
            ),
      )
      .orderBy(asc(gmDepartmentTable.createdAt)),
  create: async (tx, ws, b) => {
    const [row] = await tx
      .insert(gmDepartmentTable)
      .values({
        workspaceId: ws,
        name: b.name as string,
        parentId: (b.parentId as string | undefined) ?? null,
        headUserId: (b.headUserId as string | undefined) ?? null,
        active: (b.active as boolean | undefined) ?? true,
      })
      .returning();
    return row as Row;
  },
  update: async (tx, ws, id, b) => {
    const [before] = await tx
      .select()
      .from(gmDepartmentTable)
      .where(
        and(
          eq(gmDepartmentTable.id, id),
          eq(gmDepartmentTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmDepartmentTable)
      .set(
        patch<typeof gmDepartmentTable.$inferInsert>(b, [
          "name",
          "parentId",
          "headUserId",
          "active",
        ]),
      )
      .where(
        and(
          eq(gmDepartmentTable.id, id),
          eq(gmDepartmentTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
  deactivate: async (tx, ws, id) => {
    const [before] = await tx
      .select()
      .from(gmDepartmentTable)
      .where(
        and(
          eq(gmDepartmentTable.id, id),
          eq(gmDepartmentTable.workspaceId, ws),
        ),
      )
      .limit(1);
    if (!before) return null;
    const [after] = await tx
      .update(gmDepartmentTable)
      .set({ active: false })
      .where(
        and(
          eq(gmDepartmentTable.id, id),
          eq(gmDepartmentTable.workspaceId, ws),
        ),
      )
      .returning();
    return { before: before as Row, after: after as Row };
  },
});

// ── Approval chains (chain + ordered steps, edited as a unit) ─────────────────

const approvalStepSchema = v.object({
  stepOrder: v.pipe(v.number(), v.integer()),
  mode: v.optional(v.picklist(["sequential", "parallel"])),
  approverType: v.picklist(["role", "users"]),
  approverRefs: v.array(v.string()),
  quorum: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  slaHours: v.optional(v.number()),
  condition: v.optional(v.record(v.string(), v.unknown())),
});
type ApprovalStepInput = v.InferOutput<typeof approvalStepSchema>;

async function replaceSteps(
  tx: Tx,
  chainId: string,
  steps: ApprovalStepInput[],
) {
  await tx
    .delete(gmApprovalStepTable)
    .where(eq(gmApprovalStepTable.chainId, chainId));
  if (steps.length) {
    await tx.insert(gmApprovalStepTable).values(
      steps.map((s) => ({
        chainId,
        stepOrder: s.stepOrder,
        mode: s.mode ?? "sequential",
        approverType: s.approverType,
        approverRefs: s.approverRefs,
        quorum: s.quorum ?? 1,
        slaHours: s.slaHours ?? null,
        condition: s.condition ?? null,
      })),
    );
  }
}

async function loadChain(workspaceId: string, id: string) {
  const [chain] = await db
    .select()
    .from(gmApprovalChainTable)
    .where(
      and(
        eq(gmApprovalChainTable.id, id),
        eq(gmApprovalChainTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!chain) return null;
  const steps = await db
    .select()
    .from(gmApprovalStepTable)
    .where(eq(gmApprovalStepTable.chainId, id))
    .orderBy(asc(gmApprovalStepTable.stepOrder));
  return { ...chain, steps };
}

app.get(
  "/config/approval-chains",
  validator(
    "query",
    v.object({ workspaceId: v.string(), includeInactive: optStr }),
  ),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const inc = c.req.valid("query").includeInactive === "true";
    const chains = await db
      .select()
      .from(gmApprovalChainTable)
      .where(
        inc
          ? eq(gmApprovalChainTable.workspaceId, ws)
          : and(
              eq(gmApprovalChainTable.workspaceId, ws),
              eq(gmApprovalChainTable.active, true),
            ),
      )
      .orderBy(asc(gmApprovalChainTable.createdAt));
    return c.json(chains);
  },
);

app.get(
  "/config/approval-chains/:id",
  validator("param", v.object({ id: v.string() })),
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const { id } = c.req.valid("param");
    const chain = await loadChain(ws, id);
    if (!chain) throw new HTTPException(404, { message: "Not found" });
    return c.json(chain);
  },
);

app.post(
  "/config/approval-chains",
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      name: v.string(),
      appliesTo: optRec,
      active: optBool,
      steps: v.optional(v.array(approvalStepSchema)),
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    await assertGmAdmin(userId, ws);
    const body = c.req.valid("json");
    const chainId = await db.transaction(async (tx) => {
      const [chain] = await tx
        .insert(gmApprovalChainTable)
        .values({
          workspaceId: ws,
          name: body.name,
          appliesTo: body.appliesTo ?? null,
          active: body.active ?? true,
        })
        .returning();
      if (!chain) throw new HTTPException(500, { message: "Create failed" });
      await replaceSteps(tx, chain.id, body.steps ?? []);
      await recordAuditEvent(tx, {
        workspaceId: ws,
        entityType: "gm_approval_chain",
        entityId: chain.id,
        action: "create",
        actorId: userId,
        after: { ...chain, steps: body.steps ?? [] },
        ip: getIp(c),
      });
      return chain.id;
    });
    return c.json(await loadChain(ws, chainId), 201);
  },
);

app.put(
  "/config/approval-chains/:id",
  validator("param", v.object({ id: v.string() })),
  validator(
    "json",
    v.object({
      workspaceId: v.string(),
      name: optStr,
      appliesTo: optRec,
      active: optBool,
      steps: v.optional(v.array(approvalStepSchema)),
    }),
  ),
  workspaceAccess.fromBody("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    await assertGmAdmin(userId, ws);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const before = await loadChain(ws, id);
    if (!before) throw new HTTPException(404, { message: "Not found" });
    await db.transaction(async (tx) => {
      await tx
        .update(gmApprovalChainTable)
        .set(
          patch<typeof gmApprovalChainTable.$inferInsert>(body, [
            "name",
            "appliesTo",
            "active",
          ]),
        )
        .where(
          and(
            eq(gmApprovalChainTable.id, id),
            eq(gmApprovalChainTable.workspaceId, ws),
          ),
        );
      if (body.steps !== undefined) await replaceSteps(tx, id, body.steps);
      await recordAuditEvent(tx, {
        workspaceId: ws,
        entityType: "gm_approval_chain",
        entityId: id,
        action: "update",
        actorId: userId,
        before,
        after: { ...before, ...body },
        ip: getIp(c),
      });
    });
    return c.json(await loadChain(ws, id));
  },
);

app.delete(
  "/config/approval-chains/:id",
  validator("param", v.object({ id: v.string() })),
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    await assertGmAdmin(userId, ws);
    const { id } = c.req.valid("param");
    const before = await loadChain(ws, id);
    if (!before) throw new HTTPException(404, { message: "Not found" });
    await db.transaction(async (tx) => {
      await tx
        .update(gmApprovalChainTable)
        .set({ active: false })
        .where(
          and(
            eq(gmApprovalChainTable.id, id),
            eq(gmApprovalChainTable.workspaceId, ws),
          ),
        );
      await recordAuditEvent(tx, {
        workspaceId: ws,
        entityType: "gm_approval_chain",
        entityId: id,
        action: "deactivate",
        actorId: userId,
        before,
        ip: getIp(c),
      });
    });
    return c.json({ success: true });
  },
);

// ── Audit chain verification (GM admin) ──────────────────────────────────────

app.get(
  "/audit/verify",
  validator("query", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromQuery("workspaceId"),
  pageAccess,
  async (c) => {
    const ws = c.get("workspaceId") as string;
    const userId = c.get("userId") as string;
    await assertGmAdmin(userId, ws);
    return c.json(await verifyAuditChain(ws));
  },
);

export default app;
