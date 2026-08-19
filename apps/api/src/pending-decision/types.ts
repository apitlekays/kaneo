export type PendingDecisionDecision = "accepted" | "rejected";

/** One piece of work awaiting a user's accept-or-reject. */
export type PendingDecisionItem = {
  source: string;
  /** Opaque to the client; only the owning provider decodes it. */
  id: string;
  title: string;
  subtitle: string;
  context: string[];
  href: string;
  createdAt: Date;
  requiresReason: boolean;
};

export type PendingDecisionProvider = {
  source: string;
  list(userId: string, workspaceId: string): Promise<PendingDecisionItem[]>;
  decide(args: {
    userId: string;
    workspaceId: string;
    id: string;
    decision: PendingDecisionDecision;
    reason: string | null;
    ip: string | null;
  }): Promise<void>;
};
