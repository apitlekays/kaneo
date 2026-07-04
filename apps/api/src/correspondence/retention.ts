import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as v from "valibot";
import db from "../database";
import {
  gmRetentionClassTable,
  letterDispositionTable,
  letterLegalHoldTable,
  letterTable,
  userTable,
} from "../database/schema";
import { getPrivateObject, putLetterObject } from "../storage/s3";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { recordAuditEvent } from "./audit";
import { assertGmAdmin } from "./roles";

type GmEnv = { Variables: { userId: string; workspaceId?: string } };
const pageAccess = requireWorkspacePageAccess("general-management");

function getIp(c: Context) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    null
  );
}

async function loadLetter(workspaceId: string, id: string) {
  const [letter] = await db
    .select()
    .from(letterTable)
    .where(
      and(eq(letterTable.id, id), eq(letterTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return letter ?? null;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Retention due date from the class trigger. */
export function retentionDueDate(
  closedAt: Date,
  retentionMonths: number,
  trigger: string,
) {
  const base =
    trigger === "fy-end"
      ? new Date(Date.UTC(closedAt.getUTCFullYear(), 11, 31))
      : closedAt;
  return addMonths(base, retentionMonths);
}

async function generateCertificatePdf(lines: [string, string][]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.1, 0.1, 0.1);
  let y = 780;
  page.drawText("Certificate of Disposition", {
    x: 56,
    y,
    size: 18,
    font: bold,
    color: black,
  });
  y -= 14;
  page.drawText("MAPIMCore — General Management", {
    x: 56,
    y,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 40;
  for (const [label, value] of lines) {
    page.drawText(label, { x: 56, y, size: 11, font: bold, color: black });
    page.drawText(value, { x: 220, y, size: 11, font, color: black });
    y -= 22;
  }
  return pdf.save();
}

export function registerRetentionRoutes(app: Hono<GmEnv>) {
  app
    // ── Disposition queue (records past retention, not on hold) ───────────────
    .get(
      "/disposition-queue",
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const classes = await db
          .select()
          .from(gmRetentionClassTable)
          .where(eq(gmRetentionClassTable.workspaceId, ws));
        const classMap = new Map(classes.map((r) => [r.id, r]));
        const letters = await db
          .select()
          .from(letterTable)
          .where(
            and(
              eq(letterTable.workspaceId, ws),
              eq(letterTable.legalHold, false),
              isNull(letterTable.dispositionStatus),
            ),
          );
        const now = new Date();
        const due = letters
          .filter((l) => l.closedAt && l.retentionClassId)
          .map((l) => {
            const cls = classMap.get(l.retentionClassId as string);
            if (!cls) return null;
            const dueAt = retentionDueDate(
              l.closedAt as Date,
              cls.retentionMonths,
              cls.trigger,
            );
            return {
              letter: l,
              className: cls.name,
              dueAt,
              action: cls.dispositionAction,
            };
          })
          .filter(
            (r): r is NonNullable<typeof r> => r != null && r.dueAt <= now,
          )
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
        return c.json(due);
      },
    )
    // ── Set retention class ───────────────────────────────────────────────────
    .post(
      "/letters/:id/retention",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), retentionClassId: v.string() }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { retentionClassId } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [cls] = await db
          .select({ id: gmRetentionClassTable.id })
          .from(gmRetentionClassTable)
          .where(
            and(
              eq(gmRetentionClassTable.id, retentionClassId),
              eq(gmRetentionClassTable.workspaceId, ws),
            ),
          )
          .limit(1);
        if (!cls)
          throw new HTTPException(400, { message: "Invalid retention class" });
        const row = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(letterTable)
            .set({ retentionClassId, updatedAt: new Date() })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "set-retention",
            actorId: userId,
            before: { retentionClassId: letter.retentionClassId },
            after: { retentionClassId },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Place legal hold ──────────────────────────────────────────────────────
    .post(
      "/letters/:id/legal-hold",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), reason: v.string() }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const { id } = c.req.valid("param");
        const { reason } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const row = await db.transaction(async (tx) => {
          await tx.insert(letterLegalHoldTable).values({
            letterId: id,
            reason,
            placedBy: userId,
          });
          const [updated] = await tx
            .update(letterTable)
            .set({ legalHold: true, updatedAt: new Date() })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "legal-hold-place",
            actorId: userId,
            after: { reason },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Release legal hold ────────────────────────────────────────────────────
    .post(
      "/letters/:id/legal-hold/release",
      validator("param", v.object({ id: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const row = await db.transaction(async (tx) => {
          await tx
            .update(letterLegalHoldTable)
            .set({ releasedBy: userId, releasedAt: new Date() })
            .where(
              and(
                eq(letterLegalHoldTable.letterId, id),
                isNull(letterLegalHoldTable.releasedAt),
              ),
            );
          const [updated] = await tx
            .update(letterTable)
            .set({ legalHold: false, updatedAt: new Date() })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "legal-hold-release",
            actorId: userId,
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Authorize disposition (Records Manager) ───────────────────────────────
    .post(
      "/letters/:id/dispose",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          action: v.picklist(["destroy", "transfer", "permanent", "review"]),
          note: v.optional(v.string()),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        await assertGmAdmin(userId, ws);
        const { id } = c.req.valid("param");
        const { action, note } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.legalHold)
          throw new HTTPException(409, {
            message: "Cannot dispose a record under legal hold",
          });
        if (letter.dispositionStatus)
          throw new HTTPException(409, { message: "Already dispositioned" });

        const [actor] = await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, userId))
          .limit(1);
        const executedAt = new Date();
        const certBytes = await generateCertificatePdf([
          ["Reference:", letter.refNo ?? id],
          ["Subject:", letter.subject],
          ["Disposition:", action],
          ["Authorized by:", actor?.name ?? userId],
          ["Date:", executedAt.toISOString()],
          ["Note:", note ?? "—"],
        ]);
        const filename = `${(letter.refNo ?? id).replace(/[^A-Za-z0-9._-]+/g, "-")}-disposition.pdf`;
        const certKey = await putLetterObject(
          ws,
          id,
          filename,
          "application/pdf",
          certBytes,
        );
        const certHash = createHash("sha256").update(certBytes).digest("hex");
        const newStatus =
          action === "destroy" || action === "transfer"
            ? "disposed"
            : action === "permanent"
              ? "archived"
              : letter.status;

        const row = await db.transaction(async (tx) => {
          await tx.insert(letterDispositionTable).values({
            letterId: id,
            action,
            authorizedBy: userId,
            certificateObjectKey: certKey,
            certificateHash: certHash,
            note: note ?? null,
            executedAt,
          });
          const [updated] = await tx
            .update(letterTable)
            .set({
              dispositionStatus: action,
              status: newStatus,
              updatedAt: executedAt,
            })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "dispose",
            actorId: userId,
            after: { action, certHash, note },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Download the disposition certificate (audited) ────────────────────────
    .get(
      "/letters/:id/disposition/certificate",
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [disp] = await db
          .select()
          .from(letterDispositionTable)
          .where(eq(letterDispositionTable.letterId, id))
          .orderBy(desc(letterDispositionTable.executedAt))
          .limit(1);
        if (!disp?.certificateObjectKey)
          throw new HTTPException(404, { message: "No certificate" });
        await db.transaction(async (tx) => {
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "download-certificate",
            actorId: userId,
            ip: getIp(c),
          });
        });
        try {
          const object = await getPrivateObject(disp.certificateObjectKey);
          return new Response(object.body as BodyInit, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `inline; filename="disposition-${id}.pdf"`,
            },
          });
        } catch {
          throw new HTTPException(404, { message: "Certificate not found" });
        }
      },
    );
}

/** Legal holds + dispositions for the letter detail. */
export async function loadLifecycleDetail(letterId: string) {
  const [holds, dispositions] = await Promise.all([
    db
      .select()
      .from(letterLegalHoldTable)
      .where(eq(letterLegalHoldTable.letterId, letterId))
      .orderBy(asc(letterLegalHoldTable.placedAt)),
    db
      .select()
      .from(letterDispositionTable)
      .where(eq(letterDispositionTable.letterId, letterId))
      .orderBy(desc(letterDispositionTable.executedAt)),
  ]);
  return { holds, dispositions };
}
