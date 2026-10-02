import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import {
  assetDisposalRequestTable,
  assetDisposalSettingTable,
  assetDisposalStepTable,
  assetRentalTable,
  meetingBodyTable,
  registeredAssetTable,
  userTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { requireWorkspacePageAccess } from "../utils/page-access";
import { isGlobalAdmin } from "../utils/project-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  DISPOSAL_REASONS,
  MIN_PROPOSAL_JUSTIFICATION,
  OPEN_REQUEST_STATUSES,
  resolveCeoStage,
  resolveChairStage,
  resolveDisposalCommittee,
} from "./disposal-rules";
import { loadAsset, recordActivity } from "./index";

const pageAccess = requireWorkspacePageAccess("assets-management");

export const REASON_LABELS: Record<string, string> = {
  "beyond-repair": "Beyond economical repair",
  obsolete: "Obsolete",
  damaged: "Damaged",
  lost: "Lost",
  surplus: "Surplus to requirements",
  override: "Recorded directly by a global admin",
};

const actor = alias(userTable, "step_actor");
const proposer = alias(userTable, "proposer");
const decider = alias(userTable, "decider");

function requireJustification(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    throw new HTTPException(400, { message: "A justification is required" });
  }
  return text;
}

async function userName(userId: string | null) {
  if (!userId) return "Someone";
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? "Someone";
}

async function setAssetStatus(assetId: string, status: string) {
  await db
    .update(registeredAssetTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(registeredAssetTable.id, assetId));
}

/** Every step of every disposal request for the given ids, oldest first. */
async function loadSteps(requestIds: string[]) {
  if (requestIds.length === 0) return new Map<string, Step[]>();
  const rows = await db
    .select({ step: assetDisposalStepTable, actorName: actor.name })
    .from(assetDisposalStepTable)
    .leftJoin(actor, eq(assetDisposalStepTable.actorUserId, actor.id))
    .where(inArray(assetDisposalStepTable.requestId, requestIds))
    .orderBy(asc(assetDisposalStepTable.createdAt));
  const map = new Map<string, Step[]>();
  for (const r of rows) {
    const list = map.get(r.step.requestId) ?? [];
    list.push({ ...r.step, actorName: r.actorName });
    map.set(r.step.requestId, list);
  }
  return map;
}
type Step = typeof assetDisposalStepTable.$inferSelect & {
  actorName: string | null;
};

async function addStep(values: typeof assetDisposalStepTable.$inferInsert) {
  await db.insert(assetDisposalStepTable).values(values);
}

// ── Decisions (called by the pending-decision provider) ──────────────────

export type DisposalDecision = {
  userId: string;
  workspaceId: string;
  requestId: string;
  decision: "accepted" | "rejected";
  reason: string | null;
};

/**
 * Applies a chair-stage or CEO-stage decision. Only the decider the stage
 * was routed to may decide it, and only once — the status predicate on the
 * update is the guard against two decisions racing.
 */
export async function decideDisposal({
  userId,
  workspaceId,
  requestId,
  decision,
  reason,
}: DisposalDecision) {
  const justification = requireJustification(reason);
  const [request] = await db
    .select({
      request: assetDisposalRequestTable,
      assetName: registeredAssetTable.name,
    })
    .from(assetDisposalRequestTable)
    .innerJoin(
      registeredAssetTable,
      eq(assetDisposalRequestTable.assetId, registeredAssetTable.id),
    )
    .where(
      and(
        eq(assetDisposalRequestTable.id, requestId),
        eq(assetDisposalRequestTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!request) throw new HTTPException(404, { message: "Not found" });
  const r = request.request;
  const assetName = request.assetName;

  if (r.status !== "proposed" && r.status !== "awaiting_ceo") {
    throw new HTTPException(409, {
      message: "This proposal was already decided",
    });
  }
  if (r.pendingDeciderId !== userId) {
    throw new HTTPException(403, {
      message: "This proposal is not waiting on your decision",
    });
  }

  const stage = r.status === "proposed" ? "chair" : "ceo";
  const proposerId = r.proposedBy ?? "";

  // Who the decider acted as, for the record.
  let actedAs: string = stage;
  if (stage === "chair") {
    const committee = await resolveDisposalCommittee(workspaceId);
    actedAs = committee?.chairUserId === userId ? "chair" : "secretary";
  } else {
    const ceo = await resolveCeoStage(workspaceId, proposerId).catch(
      () => null,
    );
    actedAs = ceo?.actedAs ?? "ceo";
  }

  let nextStatus: string;
  let nextDecider: string | null = null;
  if (stage === "chair" && decision === "accepted") {
    // Resolved now, so a change of CEO since the proposal is honoured.
    const ceo = await resolveCeoStage(workspaceId, proposerId);
    nextStatus = "awaiting_ceo";
    nextDecider = ceo.userId;
  } else if (stage === "chair") {
    nextStatus = "not_supported";
  } else if (decision === "accepted") {
    nextStatus = "approved";
  } else {
    nextStatus = "rejected";
  }

  const now = new Date();
  const claimed = await db
    .update(assetDisposalRequestTable)
    .set({
      status: nextStatus,
      pendingDeciderId: nextDecider,
      decidedAt: nextDecider ? null : now,
    })
    .where(
      and(
        eq(assetDisposalRequestTable.id, requestId),
        eq(assetDisposalRequestTable.status, r.status),
        eq(assetDisposalRequestTable.pendingDeciderId, userId),
      ),
    )
    .returning({ id: assetDisposalRequestTable.id });
  if (claimed.length === 0) {
    throw new HTTPException(409, {
      message: "This proposal was already decided",
    });
  }

  const outcome =
    stage === "chair"
      ? decision === "accepted"
        ? "supported"
        : "not_supported"
      : decision === "accepted"
        ? "approved"
        : "rejected";
  await addStep({
    requestId,
    stage,
    outcome,
    actorUserId: userId,
    actedAs,
    justification,
  });

  const deciderName = await userName(userId);
  const closed = nextStatus === "not_supported" || nextStatus === "rejected";
  if (closed) await setAssetStatus(r.assetId, r.previousAssetStatus);
  if (nextStatus === "approved") {
    await setAssetStatus(r.assetId, "approved-for-disposal");
  }
  await recordActivity(r.assetId, `disposal_${outcome}`, userId, {
    requestId,
  });

  const notify = (
    to: string | null,
    type: string,
    title: string,
    content: string,
  ) =>
    to
      ? createNotification({
          userId: to,
          type,
          title,
          content,
          resourceId: r.assetId,
          resourceType: "asset",
        }).catch(() => {})
      : Promise.resolve();

  if (nextStatus === "awaiting_ceo") {
    await notify(
      nextDecider,
      "asset_disposal_approval",
      `Disposal approval needed — ${assetName}`,
      `${deciderName} (committee ${actedAs}) supported disposing of ${assetName}: "${justification}". Approve or reject it from your pending decisions.`,
    );
  } else {
    const verdict = {
      not_supported: "was not supported by the committee",
      approved: "was approved by the CEO",
      rejected: "was rejected by the CEO",
    }[nextStatus as "not_supported" | "approved" | "rejected"];
    await notify(
      r.proposedBy,
      "asset_disposal_outcome",
      `Disposal proposal ${outcome.replace("_", " ")} — ${assetName}`,
      `Your proposal to dispose of ${assetName} ${verdict}. ${deciderName}: "${justification}"${
        closed ? " The asset is back in normal use." : ""
      }`,
    );
    if (nextStatus === "rejected") {
      // The chair supported it, so they are told the outcome too.
      const [chairStep] = await db
        .select({ actorUserId: assetDisposalStepTable.actorUserId })
        .from(assetDisposalStepTable)
        .where(
          and(
            eq(assetDisposalStepTable.requestId, requestId),
            eq(assetDisposalStepTable.stage, "chair"),
          ),
        )
        .limit(1);
      if (chairStep?.actorUserId && chairStep.actorUserId !== r.proposedBy) {
        await notify(
          chairStep.actorUserId,
          "asset_disposal_outcome",
          `Disposal rejected by the CEO — ${assetName}`,
          `The disposal of ${assetName} you supported was rejected. ${deciderName}: "${justification}"`,
        );
      }
    }
  }
}

/** Requests waiting on this user's decision, for the pending-decision dialog. */
export async function listDisposalDecisions(
  userId: string,
  workspaceId: string,
) {
  const rows = await db
    .select({
      request: assetDisposalRequestTable,
      assetName: registeredAssetTable.name,
      serialNumber: registeredAssetTable.serialNumber,
      proposerName: proposer.name,
    })
    .from(assetDisposalRequestTable)
    .innerJoin(
      registeredAssetTable,
      eq(assetDisposalRequestTable.assetId, registeredAssetTable.id),
    )
    .leftJoin(proposer, eq(assetDisposalRequestTable.proposedBy, proposer.id))
    .where(
      and(
        eq(assetDisposalRequestTable.workspaceId, workspaceId),
        eq(assetDisposalRequestTable.pendingDeciderId, userId),
        inArray(assetDisposalRequestTable.status, ["proposed", "awaiting_ceo"]),
      ),
    )
    .orderBy(asc(assetDisposalRequestTable.createdAt));
  const steps = await loadSteps(rows.map((r) => r.request.id));
  return rows.map((r) => ({ ...r, steps: steps.get(r.request.id) ?? [] }));
}

// ── Routes ───────────────────────────────────────────────────────────────

const assetDisposals = new Hono<{
  Variables: { userId: string; workspaceId: string };
}>()
  // Settings: which committee reviews disposals.
  .get(
    "/disposal-settings",
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const committee = await resolveDisposalCommittee(workspaceId);
      const [setting] = await db
        .select({
          committeeBodyId: assetDisposalSettingTable.committeeBodyId,
          committeeName: meetingBodyTable.name,
        })
        .from(assetDisposalSettingTable)
        .leftJoin(
          meetingBodyTable,
          eq(assetDisposalSettingTable.committeeBodyId, meetingBodyTable.id),
        )
        .where(eq(assetDisposalSettingTable.workspaceId, workspaceId))
        .limit(1);
      const [chairName, secretaryName] = await Promise.all([
        committee?.chairUserId ? userName(committee.chairUserId) : null,
        committee?.secretaryUserId ? userName(committee.secretaryUserId) : null,
      ]);
      return c.json({
        committeeBodyId: setting?.committeeBodyId ?? null,
        committeeName: setting?.committeeName ?? null,
        chairName,
        secretaryName,
        canEdit: await isGlobalAdmin(c.get("userId"), workspaceId),
      });
    },
  )
  .put(
    "/disposal-settings",
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        committeeBodyId: v.nullable(v.string()),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      if (!(await isGlobalAdmin(c.get("userId"), workspaceId))) {
        throw new HTTPException(403, {
          message: "Only global admins can change disposal settings",
        });
      }
      const { committeeBodyId } = c.req.valid("json");
      if (committeeBodyId) {
        const [body] = await db
          .select({ id: meetingBodyTable.id })
          .from(meetingBodyTable)
          .where(
            and(
              eq(meetingBodyTable.id, committeeBodyId),
              eq(meetingBodyTable.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!body)
          throw new HTTPException(400, { message: "Unknown committee" });
      }
      await db
        .insert(assetDisposalSettingTable)
        .values({ workspaceId, committeeBodyId })
        .onConflictDoUpdate({
          target: assetDisposalSettingTable.workspaceId,
          set: { committeeBodyId, updatedAt: new Date() },
        });
      return c.json({ success: true });
    },
  )
  // Every request in the workspace — the committee's working list.
  .get(
    "/disposal-requests",
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const rows = await db
        .select({
          request: assetDisposalRequestTable,
          assetName: registeredAssetTable.name,
          serialNumber: registeredAssetTable.serialNumber,
          proposerName: proposer.name,
          deciderName: decider.name,
        })
        .from(assetDisposalRequestTable)
        .innerJoin(
          registeredAssetTable,
          eq(assetDisposalRequestTable.assetId, registeredAssetTable.id),
        )
        .leftJoin(
          proposer,
          eq(assetDisposalRequestTable.proposedBy, proposer.id),
        )
        .leftJoin(
          decider,
          eq(assetDisposalRequestTable.pendingDeciderId, decider.id),
        )
        .where(eq(assetDisposalRequestTable.workspaceId, workspaceId))
        .orderBy(desc(assetDisposalRequestTable.createdAt));
      const steps = await loadSteps(rows.map((r) => r.request.id));
      return c.json(
        rows.map((r) => ({
          ...r.request,
          assetName: r.assetName,
          serialNumber: r.serialNumber,
          proposerName: r.proposerName,
          pendingDeciderName: r.deciderName,
          steps: steps.get(r.request.id) ?? [],
        })),
      );
    },
  )
  .get(
    "/:id/disposal-requests",
    validator("param", v.object({ id: v.string() })),
    validator("query", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromQuery("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const { id } = c.req.valid("param");
      await loadAsset(id, workspaceId);
      const rows = await db
        .select({
          request: assetDisposalRequestTable,
          proposerName: proposer.name,
          deciderName: decider.name,
        })
        .from(assetDisposalRequestTable)
        .leftJoin(
          proposer,
          eq(assetDisposalRequestTable.proposedBy, proposer.id),
        )
        .leftJoin(
          decider,
          eq(assetDisposalRequestTable.pendingDeciderId, decider.id),
        )
        .where(eq(assetDisposalRequestTable.assetId, id))
        .orderBy(desc(assetDisposalRequestTable.createdAt));
      const steps = await loadSteps(rows.map((r) => r.request.id));
      return c.json(
        rows.map((r) => ({
          ...r.request,
          proposerName: r.proposerName,
          pendingDeciderName: r.deciderName,
          steps: steps.get(r.request.id) ?? [],
        })),
      );
    },
  )
  // Stage 1 — propose.
  .post(
    "/:id/disposal-requests",
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        workspaceId: v.string(),
        reasonCategory: v.picklist(DISPOSAL_REASONS),
        justification: v.string(),
        // The confirmation steps, enforced here as well as in the dialog.
        confirmServiceable: v.literal(true),
        confirmSerial: v.string(),
      }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const asset = await loadAsset(id, workspaceId);

      const justification = body.justification.trim();
      if (justification.length < MIN_PROPOSAL_JUSTIFICATION) {
        throw new HTTPException(400, {
          message: `Explain why in at least ${MIN_PROPOSAL_JUSTIFICATION} characters`,
        });
      }
      if (body.confirmSerial.trim() !== asset.serialNumber) {
        throw new HTTPException(400, {
          message: "Type the asset's serial number to confirm",
        });
      }
      if (asset.currentCustodianId && asset.currentCustodianId !== userId) {
        throw new HTTPException(403, {
          message: "Only the asset's custodian can propose it for disposal",
        });
      }
      if (["disposed", "retired"].includes(asset.status)) {
        throw new HTTPException(400, {
          message: `A ${asset.status} asset cannot be proposed for disposal`,
        });
      }
      const [open] = await db
        .select({ id: assetDisposalRequestTable.id })
        .from(assetDisposalRequestTable)
        .where(
          and(
            eq(assetDisposalRequestTable.assetId, id),
            inArray(assetDisposalRequestTable.status, [
              ...OPEN_REQUEST_STATUSES,
            ]),
          ),
        )
        .limit(1);
      if (open) {
        throw new HTTPException(409, {
          message: "This asset already has a disposal proposal in progress",
        });
      }
      const [rental] = await db
        .select({ id: assetRentalTable.id })
        .from(assetRentalTable)
        .where(
          and(
            eq(assetRentalTable.assetId, id),
            isNull(assetRentalTable.returnedAt),
          ),
        )
        .limit(1);
      if (rental) {
        throw new HTTPException(400, {
          message: "This asset is out on rent — mark it returned first",
        });
      }

      // Both stages must be decidable before anything is written, so a
      // proposal can never get stuck waiting on nobody.
      const chairStage = await resolveChairStage(workspaceId, userId);
      await resolveCeoStage(workspaceId, userId);

      const [request] = await db
        .insert(assetDisposalRequestTable)
        .values({
          assetId: id,
          workspaceId,
          status: "proposed",
          reasonCategory: body.reasonCategory,
          proposedBy: userId,
          previousAssetStatus: asset.status,
          pendingDeciderId: chairStage.userId,
        })
        .returning();
      if (!request) throw new HTTPException(500, { message: "Not saved" });

      await addStep({
        requestId: request.id,
        stage: "proposed",
        outcome: "proposed",
        actorUserId: userId,
        actedAs: asset.currentCustodianId ? "custodian" : "page_admin",
        justification,
      });
      await setAssetStatus(id, "pending-disposal");
      await recordActivity(id, "disposal_proposed", userId, {
        requestId: request.id,
        reasonCategory: body.reasonCategory,
      });

      await createNotification({
        userId: chairStage.userId,
        type: "asset_disposal_review",
        title: `Disposal proposal to review — ${asset.name}`,
        content: `${await userName(userId)} proposed disposing of ${asset.name} (${REASON_LABELS[body.reasonCategory]}): "${justification}". Support it or not from your pending decisions.`,
        resourceId: id,
        resourceType: "asset",
      }).catch(() => {});

      return c.json(request, 201);
    },
  )
  // The proposer can take it back until the committee has decided.
  .post(
    "/:id/disposal-requests/:requestId/withdraw",
    validator("param", v.object({ id: v.string(), requestId: v.string() })),
    validator(
      "json",
      v.object({ workspaceId: v.string(), justification: v.string() }),
    ),
    workspaceAccess.fromBody("workspaceId"),
    pageAccess,
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const userId = c.get("userId");
      const { id, requestId } = c.req.valid("param");
      const justification = requireJustification(
        c.req.valid("json").justification,
      );
      await loadAsset(id, workspaceId);
      const [request] = await db
        .select()
        .from(assetDisposalRequestTable)
        .where(
          and(
            eq(assetDisposalRequestTable.id, requestId),
            eq(assetDisposalRequestTable.assetId, id),
          ),
        )
        .limit(1);
      if (!request) throw new HTTPException(404, { message: "Not found" });
      if (request.proposedBy !== userId) {
        throw new HTTPException(403, {
          message: "Only the person who proposed it can withdraw it",
        });
      }
      const claimed = await db
        .update(assetDisposalRequestTable)
        .set({
          status: "withdrawn",
          pendingDeciderId: null,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(assetDisposalRequestTable.id, requestId),
            eq(assetDisposalRequestTable.status, "proposed"),
          ),
        )
        .returning({ id: assetDisposalRequestTable.id });
      if (claimed.length === 0) {
        throw new HTTPException(409, {
          message: "It can no longer be withdrawn — the committee has decided",
        });
      }
      await addStep({
        requestId,
        stage: "withdrawn",
        outcome: "withdrawn",
        actorUserId: userId,
        actedAs: "custodian",
        justification,
      });
      await setAssetStatus(id, request.previousAssetStatus);
      await recordActivity(id, "disposal_withdrawn", userId, { requestId });
      return c.json({ success: true });
    },
  );

export default assetDisposals;
