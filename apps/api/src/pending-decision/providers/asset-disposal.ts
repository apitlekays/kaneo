import {
  decideDisposal,
  listDisposalDecisions,
  REASON_LABELS,
} from "../../asset-registry/disposals";
import type { PendingDecisionItem, PendingDecisionProvider } from "../types";

type Row = Awaited<ReturnType<typeof listDisposalDecisions>>[number];

const ACTED_AS: Record<string, string> = {
  chair: "committee chair",
  secretary: "committee secretary",
};

/**
 * Asset disposal proposals at the committee stage (for the chair, or the
 * secretary when the chair proposed) and at the CEO stage (for the CEO, or
 * the acting CEO). The decider sees every earlier justification, and must
 * justify their own decision either way.
 */
export function toPendingItem(row: Row): PendingDecisionItem {
  const atCeo = row.request.status === "awaiting_ceo";
  const proposal = row.steps.find((s) => s.stage === "proposed");
  const support = row.steps.find((s) => s.stage === "chair");

  const context = [
    `Serial no. ${row.serialNumber} · ${REASON_LABELS[row.request.reasonCategory] ?? row.request.reasonCategory}`,
    `Proposed by ${row.proposerName ?? "someone"}: "${proposal?.justification ?? ""}"`,
  ];
  if (atCeo && support) {
    context.push(
      `Supported by ${support.actorName ?? "the committee"} (${ACTED_AS[support.actedAs] ?? support.actedAs}): "${support.justification}"`,
    );
  }

  return {
    source: "asset-disposal",
    id: row.request.id,
    title: `Dispose of ${row.assetName}?`,
    subtitle: atCeo
      ? "Disposal approval — supported by the committee"
      : "Disposal proposal — committee review",
    context,
    href: "/dashboard/category/assets-management",
    createdAt: row.request.updatedAt,
    requiresReason: true,
    reasonRequired: "always",
    labels: atCeo
      ? { accept: "Approve disposal", reject: "Reject" }
      : { accept: "Support", reject: "Do not support" },
    badges: [{ label: atCeo ? "CEO approval" : "Committee", tone: "info" }],
  };
}

export const assetDisposalProvider: PendingDecisionProvider = {
  source: "asset-disposal",
  async list(userId, workspaceId) {
    const rows = await listDisposalDecisions(userId, workspaceId);
    return rows.map(toPendingItem);
  },
  async decide({ userId, workspaceId, id, decision, reason }) {
    await decideDisposal({
      userId,
      workspaceId,
      requestId: id,
      decision,
      reason,
    });
  },
};
