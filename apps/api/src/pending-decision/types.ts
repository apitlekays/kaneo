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
  /**
   * Optional emphasis a provider wants shown on the card. Keeps the dialog
   * free of any one module's vocabulary — correspondence sends urgency here
   * rather than the dialog learning what a letter is.
   */
  badges?: { label: string; tone: "urgent" | "info" }[];
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
