import { and, asc, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  gmAuditEventTable,
  gmCategoryTable,
  gmOrganisationTable,
  gmSecurityLabelTable,
  letterDispositionTable,
  letterTable,
  userTable,
} from "../database/schema";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { assertGmAdmin } from "./roles";

type GmEnv = { Variables: { userId: string; workspaceId?: string } };
const pageAccess = requireWorkspacePageAccess("general-management");

function csvCell(value: unknown): string {
  const s =
    value == null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join(
    "\n",
  );
}

function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function registerReportRoutes(app: Hono<GmEnv>) {
  app
    // ── Inward/outward register CSV ───────────────────────────────────────────
    .get(
      "/reports/register",
      validator(
        "query",
        v.object({
          workspaceId: v.string(),
          direction: v.optional(v.picklist(["in", "out"])),
        }),
      ),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { direction } = c.req.valid("query");
        const filters = [eq(letterTable.workspaceId, ws)];
        if (direction) filters.push(eq(letterTable.direction, direction));
        const [letters, categories, labels, organisations] = await Promise.all([
          db
            .select()
            .from(letterTable)
            .where(and(...filters))
            .orderBy(asc(letterTable.createdAt)),
          db
            .select()
            .from(gmCategoryTable)
            .where(eq(gmCategoryTable.workspaceId, ws)),
          db
            .select()
            .from(gmSecurityLabelTable)
            .where(eq(gmSecurityLabelTable.workspaceId, ws)),
          db
            .select()
            .from(gmOrganisationTable)
            .where(eq(gmOrganisationTable.workspaceId, ws)),
        ]);
        const catMap = new Map(categories.map((r) => [r.id, r.label]));
        const labelMap = new Map(labels.map((r) => [r.id, r.label]));
        const orgMap = new Map(organisations.map((r) => [r.id, r.label]));
        const csv = toCsv(
          [
            "RefNo",
            "Direction",
            "Type",
            "Status",
            "Subject",
            "Party",
            "Party organisation",
            "ERN",
            "Urgency",
            "Owning organisation",
            "Category",
            "Security",
            "Received",
            "Dispatched",
            "Declared",
          ],
          letters.map((l) => [
            l.refNo,
            l.direction,
            l.type,
            l.status,
            l.subject,
            l.direction === "in" ? l.senderName : l.recipientName,
            l.direction === "in" ? l.senderOrg : l.recipientOrg,
            l.externalRefNo,
            l.urgency,
            l.organisationId ? (orgMap.get(l.organisationId) ?? "") : "",
            l.categoryId ? (catMap.get(l.categoryId) ?? "") : "",
            l.securityLabelId ? (labelMap.get(l.securityLabelId) ?? "") : "",
            l.receivedAt,
            l.dispatchedAt,
            l.declaredAt,
          ]),
        );
        return csvResponse(`register-${direction ?? "all"}.csv`, csv);
      },
    )
    // ── Disposition log CSV ───────────────────────────────────────────────────
    .get(
      "/reports/disposition",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const rows = await db
          .select({
            refNo: letterTable.refNo,
            subject: letterTable.subject,
            action: letterDispositionTable.action,
            authorizedBy: userTable.name,
            certificateHash: letterDispositionTable.certificateHash,
            note: letterDispositionTable.note,
            executedAt: letterDispositionTable.executedAt,
          })
          .from(letterDispositionTable)
          .innerJoin(
            letterTable,
            eq(letterDispositionTable.letterId, letterTable.id),
          )
          .leftJoin(
            userTable,
            eq(letterDispositionTable.authorizedBy, userTable.id),
          )
          .where(eq(letterTable.workspaceId, ws))
          .orderBy(desc(letterDispositionTable.executedAt));
        const csv = toCsv(
          [
            "RefNo",
            "Subject",
            "Action",
            "AuthorizedBy",
            "CertificateHash",
            "Note",
            "ExecutedAt",
          ],
          rows.map((r) => [
            r.refNo,
            r.subject,
            r.action,
            r.authorizedBy,
            r.certificateHash,
            r.note,
            r.executedAt,
          ]),
        );
        return csvResponse("disposition-log.csv", csv);
      },
    )
    // ── Audit trail CSV (GM admin) ────────────────────────────────────────────
    .get(
      "/reports/audit",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const rows = await db
          .select({
            seq: gmAuditEventTable.seq,
            at: gmAuditEventTable.at,
            entityType: gmAuditEventTable.entityType,
            entityId: gmAuditEventTable.entityId,
            action: gmAuditEventTable.action,
            actor: userTable.name,
            hash: gmAuditEventTable.hash,
          })
          .from(gmAuditEventTable)
          .leftJoin(userTable, eq(gmAuditEventTable.actorId, userTable.id))
          .where(eq(gmAuditEventTable.workspaceId, ws))
          .orderBy(asc(gmAuditEventTable.seq));
        const csv = toCsv(
          ["Seq", "At", "EntityType", "EntityId", "Action", "Actor", "Hash"],
          rows.map((r) => [
            r.seq,
            r.at,
            r.entityType,
            r.entityId,
            r.action,
            r.actor,
            r.hash,
          ]),
        );
        return csvResponse("audit-trail.csv", csv);
      },
    );
}
