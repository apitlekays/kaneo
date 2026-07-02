import { and, asc, desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  gmApprovalChainTable,
  gmApprovalStepTable,
  gmSignatoryTable,
  letterApprovalInstanceTable,
  letterApprovalStepInstanceTable,
  letterAttachmentTable,
  letterDraftVersionTable,
  letterSignatureTable,
  letterTable,
  userTable,
} from "../database/schema";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { getWorkspaceRole } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { recordAuditEvent } from "./audit";
import {
  generateSignedLetterPdf,
  loadSigningCredentials,
  type SignatureManifest,
  signBytes,
  storeSignedPdf,
  verifyStoredSignature,
} from "./esign";

type GmEnv = { Variables: { userId: string; workspaceId?: string } };
type Tx = Pick<typeof db, "select" | "insert" | "update">;

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

type StepDecision = {
  userId: string;
  decision: string;
  comment?: string;
  at: string;
};

/**
 * Pick the approval chain for a letter: first active chain whose appliesTo
 * matches the letter type (a chain with no letterType applies to any).
 */
async function selectChain(workspaceId: string, letterType: string) {
  const chains = await db
    .select()
    .from(gmApprovalChainTable)
    .where(
      and(
        eq(gmApprovalChainTable.workspaceId, workspaceId),
        eq(gmApprovalChainTable.active, true),
      ),
    )
    .orderBy(asc(gmApprovalChainTable.createdAt));
  const match = chains.find((chain) => {
    const applies = (chain.appliesTo ?? {}) as { letterType?: string };
    return !applies.letterType || applies.letterType === letterType;
  });
  if (!match) return null;
  const steps = await db
    .select()
    .from(gmApprovalStepTable)
    .where(eq(gmApprovalStepTable.chainId, match.id))
    .orderBy(asc(gmApprovalStepTable.stepOrder));
  return { chain: match, steps };
}

/** Instantiate the chain: snapshot steps so later chain edits don't mutate it. */
async function startApproval(
  tx: Tx,
  letterId: string,
  chain: { id: string; name: string },
  steps: {
    stepOrder: number;
    mode: string;
    approverType: string;
    approverRefs: unknown;
    quorum: number;
  }[],
) {
  const [instance] = await tx
    .insert(letterApprovalInstanceTable)
    .values({
      letterId,
      chainId: chain.id,
      chainName: chain.name,
      status: "active",
    })
    .returning();
  if (!instance)
    throw new HTTPException(500, { message: "Approval init failed" });
  if (steps.length) {
    await tx.insert(letterApprovalStepInstanceTable).values(
      steps.map((s) => ({
        instanceId: instance.id,
        stepOrder: s.stepOrder,
        mode: s.mode,
        approverType: s.approverType,
        approverRefs: s.approverRefs as never,
        quorum: s.quorum,
        status: "pending",
        decisions: [] as never,
      })),
    );
  }
  return instance;
}

async function activeInstance(letterId: string) {
  const [instance] = await db
    .select()
    .from(letterApprovalInstanceTable)
    .where(
      and(
        eq(letterApprovalInstanceTable.letterId, letterId),
        eq(letterApprovalInstanceTable.status, "active"),
      ),
    )
    .orderBy(asc(letterApprovalInstanceTable.createdAt))
    .limit(1);
  return instance ?? null;
}

export function registerOutgoingRoutes(app: Hono<GmEnv>) {
  app
    // ── Save a draft body version ─────────────────────────────────────────────
    .post(
      "/letters/:id/draft-version",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({ workspaceId: v.string(), bodyHtml: v.string() }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { bodyHtml } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.declaredAt)
          throw new HTTPException(409, { message: "Letter is declared" });
        const existing = await db
          .select({ version: letterDraftVersionTable.version })
          .from(letterDraftVersionTable)
          .where(eq(letterDraftVersionTable.letterId, id));
        const nextVersion =
          existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;
        const row = await db.transaction(async (tx) => {
          const [version] = await tx
            .insert(letterDraftVersionTable)
            .values({
              letterId: id,
              version: nextVersion,
              bodyHtml,
              createdBy: userId,
            })
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "draft-version",
            actorId: userId,
            after: version,
            ip: getIp(c),
          });
          return version;
        });
        return c.json(row, 201);
      },
    )
    // ── Submit for review (maker → checker) ───────────────────────────────────
    .post(
      "/letters/:id/submit-review",
      validator("param", v.object({ id: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.direction !== "out")
          throw new HTTPException(400, {
            message: "Only outgoing letters go through review",
          });
        if (!["draft", "captured"].includes(letter.status))
          throw new HTTPException(409, {
            message: `Cannot submit from status ${letter.status}`,
          });
        const row = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(letterTable)
            .set({ status: "in-review", updatedAt: new Date() })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "submit-review",
            actorId: userId,
            before: letter,
            after: updated,
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Reviewer decision (checker ≠ drafter) ─────────────────────────────────
    .post(
      "/letters/:id/review-decision",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          decision: v.picklist(["approve", "return"]),
          comment: v.optional(v.string()),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { decision, comment } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.status !== "in-review")
          throw new HTTPException(409, { message: "Not in review" });
        if (letter.createdBy && letter.createdBy === userId)
          throw new HTTPException(403, {
            message: "The drafter cannot review their own letter",
          });

        if (decision === "return") {
          const row = await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(letterTable)
              .set({ status: "draft", updatedAt: new Date() })
              .where(
                and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)),
              )
              .returning();
            await recordAuditEvent(tx, {
              workspaceId: ws,
              entityType: "letter",
              entityId: id,
              action: "review-return",
              actorId: userId,
              after: { comment },
              ip: getIp(c),
            });
            return updated;
          });
          return c.json(row);
        }

        // Approved review → start the approval chain (or approve directly).
        const selected = await selectChain(ws, letter.type);
        const row = await db.transaction(async (tx) => {
          let status = "approved";
          if (selected && selected.steps.length) {
            await startApproval(tx, id, selected.chain, selected.steps);
            status = "approving";
          }
          const [updated] = await tx
            .update(letterTable)
            .set({ status, updatedAt: new Date() })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "review-approve",
            actorId: userId,
            after: { status, chain: selected?.chain.name ?? null, comment },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(row);
      },
    )
    // ── Approval-step decision (the configurable chain engine) ────────────────
    .post(
      "/letters/:id/approval-decision",
      validator("param", v.object({ id: v.string() })),
      validator(
        "json",
        v.object({
          workspaceId: v.string(),
          stepInstanceId: v.string(),
          decision: v.picklist(["approve", "reject", "return"]),
          comment: v.optional(v.string()),
        }),
      ),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const { stepInstanceId, decision, comment } = c.req.valid("json");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.status !== "approving")
          throw new HTTPException(409, { message: "Not awaiting approval" });
        if (letter.createdBy && letter.createdBy === userId)
          throw new HTTPException(403, {
            message: "The drafter cannot approve their own letter",
          });

        const instance = await activeInstance(id);
        if (!instance)
          throw new HTTPException(409, { message: "No active approval" });
        const steps = await db
          .select()
          .from(letterApprovalStepInstanceTable)
          .where(eq(letterApprovalStepInstanceTable.instanceId, instance.id))
          .orderBy(asc(letterApprovalStepInstanceTable.stepOrder));

        const current = steps.find((s) => s.status === "pending");
        if (!current || current.id !== stepInstanceId)
          throw new HTTPException(409, {
            message: "Not the current approval step",
          });

        // Eligibility: named users or a workspace role.
        const refs = (current.approverRefs ?? []) as string[];
        let eligible = false;
        if (current.approverType === "users") eligible = refs.includes(userId);
        else {
          const role = await getWorkspaceRole(userId, ws);
          eligible = role != null && refs.includes(role);
        }
        if (!eligible)
          throw new HTTPException(403, {
            message: "You are not an approver for this step",
          });

        const decisions = (current.decisions ?? []) as StepDecision[];
        if (decisions.some((d) => d.userId === userId))
          throw new HTTPException(409, {
            message: "You have already decided on this step",
          });
        decisions.push({
          userId,
          decision,
          comment,
          at: new Date().toISOString(),
        });

        const result = await db.transaction(async (tx) => {
          const now = new Date();
          if (decision === "reject") {
            await tx
              .update(letterApprovalStepInstanceTable)
              .set({
                status: "rejected",
                decisions: decisions as never,
                decidedAt: now,
              })
              .where(eq(letterApprovalStepInstanceTable.id, current.id));
            await tx
              .update(letterApprovalInstanceTable)
              .set({ status: "rejected" })
              .where(eq(letterApprovalInstanceTable.id, instance.id));
            const [updated] = await tx
              .update(letterTable)
              .set({ status: "rejected", updatedAt: now })
              .where(eq(letterTable.id, id))
              .returning();
            await recordAuditEvent(tx, {
              workspaceId: ws,
              entityType: "letter",
              entityId: id,
              action: "approval-reject",
              actorId: userId,
              after: { stepOrder: current.stepOrder, comment },
              ip: getIp(c),
            });
            return updated;
          }
          if (decision === "return") {
            await tx
              .update(letterApprovalStepInstanceTable)
              .set({
                status: "returned",
                decisions: decisions as never,
                decidedAt: now,
              })
              .where(eq(letterApprovalStepInstanceTable.id, current.id));
            await tx
              .update(letterApprovalInstanceTable)
              .set({ status: "cancelled" })
              .where(eq(letterApprovalInstanceTable.id, instance.id));
            const [updated] = await tx
              .update(letterTable)
              .set({ status: "draft", updatedAt: now })
              .where(eq(letterTable.id, id))
              .returning();
            await recordAuditEvent(tx, {
              workspaceId: ws,
              entityType: "letter",
              entityId: id,
              action: "approval-return",
              actorId: userId,
              after: { stepOrder: current.stepOrder, comment },
              ip: getIp(c),
            });
            return updated;
          }
          // approve
          const approvals = decisions.filter(
            (d) => d.decision === "approve",
          ).length;
          const quorumMet = approvals >= current.quorum;
          await tx
            .update(letterApprovalStepInstanceTable)
            .set({
              decisions: decisions as never,
              status: quorumMet ? "approved" : "pending",
              decidedAt: quorumMet ? now : null,
            })
            .where(eq(letterApprovalStepInstanceTable.id, current.id));

          let letterStatus = letter.status;
          if (quorumMet) {
            const hasNext = steps.some(
              (s) => s.stepOrder > current.stepOrder && s.status === "pending",
            );
            if (!hasNext) {
              await tx
                .update(letterApprovalInstanceTable)
                .set({ status: "approved" })
                .where(eq(letterApprovalInstanceTable.id, instance.id));
              letterStatus = "approved";
            }
          }
          const [updated] = await tx
            .update(letterTable)
            .set({ status: letterStatus, updatedAt: now })
            .where(eq(letterTable.id, id))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "approval-approve",
            actorId: userId,
            after: {
              stepOrder: current.stepOrder,
              quorumMet,
              letterStatus,
              comment,
            },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(result);
      },
    )
    // ── E-signature (approved → signed) ───────────────────────────────────────
    .post(
      "/letters/:id/sign",
      validator("param", v.object({ id: v.string() })),
      validator("json", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromBody("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const userId = c.get("userId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        if (letter.direction !== "out")
          throw new HTTPException(400, {
            message: "Only outgoing letters are signed",
          });
        if (letter.status !== "approved")
          throw new HTTPException(409, {
            message: "Letter must be approved before signing",
          });
        if (letter.createdBy && letter.createdBy === userId)
          throw new HTTPException(403, {
            message: "The drafter cannot sign their own letter",
          });
        if (!loadSigningCredentials())
          throw new HTTPException(400, {
            message:
              "Signing certificate not configured (set GM_SIGNING_KEY_B64 / GM_SIGNING_CERT_B64)",
          });
        const [signatory] = await db
          .select({ id: gmSignatoryTable.id })
          .from(gmSignatoryTable)
          .where(
            and(
              eq(gmSignatoryTable.workspaceId, ws),
              eq(gmSignatoryTable.userId, userId),
              eq(gmSignatoryTable.active, true),
            ),
          )
          .limit(1);
        if (!signatory)
          throw new HTTPException(403, {
            message: "You are not an authorized signatory",
          });
        const [user] = await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, userId))
          .limit(1);
        const signerName = user?.name ?? "Authorized signatory";
        const role = "Authorized Signatory";
        const [latest] = await db
          .select()
          .from(letterDraftVersionTable)
          .where(eq(letterDraftVersionTable.letterId, id))
          .orderBy(desc(letterDraftVersionTable.version))
          .limit(1);

        const signedAt = new Date();
        const pdfBytes = await generateSignedLetterPdf(
          letter,
          latest?.bodyHtml ?? "",
          signerName,
          role,
          signedAt,
        );
        const manifest = signBytes(
          pdfBytes,
          { signerId: userId, signerName, role },
          signedAt,
        );
        const objectKey = await storeSignedPdf(ws, id, letter.refNo, pdfBytes);
        const filename = `${(letter.refNo ?? id).replace(/[^A-Za-z0-9._-]+/g, "-")}-signed.pdf`;

        const result = await db.transaction(async (tx) => {
          await tx.insert(letterAttachmentTable).values({
            letterId: id,
            workspaceId: ws,
            objectKey,
            filename,
            mimeType: "application/pdf",
            size: pdfBytes.length,
            sha256: manifest.documentSha256,
            kind: "signed-final",
            createdBy: userId,
          });
          await tx.insert(letterSignatureTable).values({
            letterId: id,
            signerId: userId,
            method: "org-cert",
            signedObjectKey: objectKey,
            signedHash: manifest.documentSha256,
            manifest: manifest as never,
            signedAt,
          });
          const [updated] = await tx
            .update(letterTable)
            .set({ status: "signed", updatedAt: signedAt })
            .where(and(eq(letterTable.id, id), eq(letterTable.workspaceId, ws)))
            .returning();
          await recordAuditEvent(tx, {
            workspaceId: ws,
            entityType: "letter",
            entityId: id,
            action: "sign",
            actorId: userId,
            after: {
              signerName,
              documentSha256: manifest.documentSha256,
              signedObjectKey: objectKey,
            },
            ip: getIp(c),
          });
          return updated;
        });
        return c.json(result);
      },
    )
    // ── Verify a stored signature ─────────────────────────────────────────────
    .get(
      "/letters/:id/signature/verify",
      validator("param", v.object({ id: v.string() })),
      validator("query", v.object({ workspaceId: v.string() })),
      workspaceAccess.fromQuery("workspaceId"),
      pageAccess,
      async (c) => {
        const ws = c.get("workspaceId") as string;
        const { id } = c.req.valid("param");
        const letter = await loadLetter(ws, id);
        if (!letter) throw new HTTPException(404, { message: "Not found" });
        const [signature] = await db
          .select()
          .from(letterSignatureTable)
          .where(eq(letterSignatureTable.letterId, id))
          .orderBy(desc(letterSignatureTable.signedAt))
          .limit(1);
        if (!signature?.signedObjectKey || !signature.manifest)
          return c.json({ ok: false, reason: "no-signature" });
        return c.json(
          await verifyStoredSignature(
            signature.signedObjectKey,
            signature.manifest as SignatureManifest,
          ),
        );
      },
    );
}

/** Sub-records for the letter detail (approval instance + steps, versions). */
export async function loadOutgoingDetail(letterId: string) {
  const [instance] = await db
    .select()
    .from(letterApprovalInstanceTable)
    .where(eq(letterApprovalInstanceTable.letterId, letterId))
    .orderBy(asc(letterApprovalInstanceTable.createdAt))
    .limit(1);
  const approvalSteps = instance
    ? await db
        .select()
        .from(letterApprovalStepInstanceTable)
        .where(eq(letterApprovalStepInstanceTable.instanceId, instance.id))
        .orderBy(asc(letterApprovalStepInstanceTable.stepOrder))
    : [];
  const versions = await db
    .select()
    .from(letterDraftVersionTable)
    .where(eq(letterDraftVersionTable.letterId, letterId))
    .orderBy(asc(letterDraftVersionTable.version));
  const [signature] = await db
    .select()
    .from(letterSignatureTable)
    .where(eq(letterSignatureTable.letterId, letterId))
    .orderBy(desc(letterSignatureTable.signedAt))
    .limit(1);
  return {
    approval: instance ? { ...instance, steps: approvalSteps } : null,
    versions,
    signature: signature ?? null,
  };
}
