import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  assetDisposalRequestTable,
  assetDisposalSettingTable,
  assetDisposalStepTable,
  meetingBodyMemberTable,
  meetingBodyTable,
} from "../database/schema";
import { resolvePosition } from "../organisation";
import { isGlobalAdmin } from "../utils/project-access";

export const DISPOSAL_REASONS = [
  "beyond-repair",
  "obsolete",
  "damaged",
  "lost",
  "surplus",
] as const;

/** A proposal's justification must say something, not just "old". */
export const MIN_PROPOSAL_JUSTIFICATION = 30;

/** Request statuses that hold the asset; only one may exist per asset. */
export const OPEN_REQUEST_STATUSES = [
  "proposed",
  "awaiting_ceo",
  "approved",
] as const;

/**
 * Asset statuses only the disposal workflow may set or leave. Editing an
 * asset, or importing one, cannot move it into or out of these — that
 * would bypass the committee and the CEO.
 */
export const WORKFLOW_ASSET_STATUSES: ReadonlySet<string> = new Set([
  "pending-disposal",
  "approved-for-disposal",
  "disposed",
]);

export function assertManualStatusChange(current: string, next: string) {
  if (next === current) return;
  if (
    WORKFLOW_ASSET_STATUSES.has(next) ||
    WORKFLOW_ASSET_STATUSES.has(current)
  ) {
    throw new HTTPException(400, {
      message:
        "Disposal statuses are set by the disposal approval process — propose the asset for disposal instead",
    });
  }
}

export type Decider = {
  userId: string;
  actedAs: "chair" | "secretary" | "ceo" | "acting_ceo";
};

const NOT_CONFIGURED =
  "Disposal approval is not set up: choose the disposal committee (Asset Management → Disposals → Settings)";

/** The disposal committee and its chair and secretary with accounts. */
export async function resolveDisposalCommittee(workspaceId: string) {
  const [setting] = await db
    .select({ bodyId: assetDisposalSettingTable.committeeBodyId })
    .from(assetDisposalSettingTable)
    .where(eq(assetDisposalSettingTable.workspaceId, workspaceId))
    .limit(1);
  if (!setting?.bodyId) return null;

  const [body] = await db
    .select({ id: meetingBodyTable.id, name: meetingBodyTable.name })
    .from(meetingBodyTable)
    .where(
      and(
        eq(meetingBodyTable.id, setting.bodyId),
        eq(meetingBodyTable.workspaceId, workspaceId),
        eq(meetingBodyTable.active, true),
      ),
    )
    .limit(1);
  if (!body) return null;

  const members = await db
    .select({
      userId: meetingBodyMemberTable.userId,
      role: meetingBodyMemberTable.role,
    })
    .from(meetingBodyMemberTable)
    .where(
      and(
        eq(meetingBodyMemberTable.bodyId, body.id),
        eq(meetingBodyMemberTable.active, true),
      ),
    );
  const withRole = (role: string) =>
    members.find((m) => m.role === role && m.userId)?.userId ?? null;

  return {
    id: body.id,
    name: body.name,
    chairUserId: withRole("chair"),
    secretaryUserId: withRole("secretary"),
  };
}

/**
 * Who decides the committee stage. Nobody decides their own proposal: if
 * the chair proposed, the secretary decides instead.
 */
export async function resolveChairStage(
  workspaceId: string,
  proposerId: string,
): Promise<Decider> {
  const committee = await resolveDisposalCommittee(workspaceId);
  if (!committee) throw new HTTPException(400, { message: NOT_CONFIGURED });
  if (!committee.chairUserId) {
    throw new HTTPException(400, {
      message: `${committee.name} has no chair with an account — set one in General Management → Committees`,
    });
  }
  if (committee.chairUserId !== proposerId) {
    return { userId: committee.chairUserId, actedAs: "chair" };
  }
  if (committee.secretaryUserId && committee.secretaryUserId !== proposerId) {
    return { userId: committee.secretaryUserId, actedAs: "secretary" };
  }
  throw new HTTPException(400, {
    message: `The chair of ${committee.name} cannot decide their own proposal, and the committee has no secretary to decide instead`,
  });
}

/**
 * Who decides the CEO stage. If the CEO proposed, the acting CEO decides.
 */
export async function resolveCeoStage(
  workspaceId: string,
  proposerId: string,
): Promise<Decider> {
  const ceo = await resolvePosition(workspaceId, "ceo");
  if (!ceo.holderUserId) {
    throw new HTTPException(400, {
      message:
        "No CEO is set — set the office holder in General Management → Committees",
    });
  }
  if (ceo.holderUserId !== proposerId) {
    return { userId: ceo.holderUserId, actedAs: "ceo" };
  }
  if (ceo.actingUserId && ceo.actingUserId !== proposerId) {
    return { userId: ceo.actingUserId, actedAs: "acting_ceo" };
  }
  throw new HTTPException(400, {
    message:
      "The CEO cannot approve their own proposal, and no acting CEO is set",
  });
}

/**
 * Called by the record-disposal route: the physical disposal closes the
 * approved request, or — for a global admin with a justification — is
 * recorded as an audited override. Anything else is refused.
 */
export async function authoriseDisposalRecord({
  assetId,
  workspaceId,
  userId,
  overrideJustification,
  previousStatus,
}: {
  assetId: string;
  workspaceId: string;
  userId: string;
  overrideJustification: string | null | undefined;
  previousStatus: string;
}) {
  const [approved] = await db
    .select({ id: assetDisposalRequestTable.id })
    .from(assetDisposalRequestTable)
    .where(
      and(
        eq(assetDisposalRequestTable.assetId, assetId),
        eq(assetDisposalRequestTable.status, "approved"),
      ),
    )
    .limit(1);

  if (approved) {
    await db
      .update(assetDisposalRequestTable)
      .set({ status: "disposed" })
      .where(eq(assetDisposalRequestTable.id, approved.id));
    await db.insert(assetDisposalStepTable).values({
      requestId: approved.id,
      stage: "recorded",
      outcome: "recorded",
      actorUserId: userId,
      actedAs: "recorder",
      justification: "Physical disposal recorded",
    });
    return;
  }

  const justification = overrideJustification?.trim();
  if (!justification || !(await isGlobalAdmin(userId, workspaceId))) {
    throw new HTTPException(403, {
      message:
        "This asset has no approved disposal. Propose it for disposal and wait for the committee and CEO",
    });
  }
  // An override still leaves a full record: a closed request with one step.
  // Any proposal still in progress is superseded by it.
  await db
    .update(assetDisposalRequestTable)
    .set({ status: "withdrawn", pendingDeciderId: null, decidedAt: new Date() })
    .where(
      and(
        eq(assetDisposalRequestTable.assetId, assetId),
        inArray(assetDisposalRequestTable.status, ["proposed", "awaiting_ceo"]),
      ),
    );
  const [request] = await db
    .insert(assetDisposalRequestTable)
    .values({
      assetId,
      workspaceId,
      status: "disposed",
      reasonCategory: "override",
      proposedBy: userId,
      previousAssetStatus: previousStatus,
      decidedAt: new Date(),
    })
    .returning({ id: assetDisposalRequestTable.id });
  if (request) {
    await db.insert(assetDisposalStepTable).values({
      requestId: request.id,
      stage: "recorded",
      outcome: "recorded",
      actorUserId: userId,
      actedAs: "override",
      justification,
    });
  }
}
