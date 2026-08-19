import { getApiUrl } from "@/fetchers/get-api-url";

export type PendingDecisionItem = {
  source: string;
  id: string;
  title: string;
  subtitle: string;
  context: string[];
  href: string;
  /** ISO string — Date does not survive JSON. */
  createdAt: string;
  requiresReason: boolean;
};

/**
 * Carries the HTTP status, which the dialog needs: a 409 means the item was
 * already decided elsewhere, and that is not an error worth shouting about.
 */
export class PendingDecisionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PendingDecisionError";
    this.status = status;
  }
}

const url = (path: string) => getApiUrl(`pending-decision${path}`);

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new PendingDecisionError(response.status, await response.text());
  return response.json();
}

export async function getPendingDecisions(workspaceId: string): Promise<{
  items: PendingDecisionItem[];
  failedSources: string[];
}> {
  return jsonOrThrow(
    await fetch(url(`?workspaceId=${encodeURIComponent(workspaceId)}`), {
      credentials: "include",
    }),
  );
}

export async function decidePending(args: {
  workspaceId: string;
  source: string;
  id: string;
  decision: "accepted" | "rejected";
  reason: string | null;
}): Promise<void> {
  await jsonOrThrow(
    await fetch(
      url(
        `/${encodeURIComponent(args.source)}/${encodeURIComponent(args.id)}/decide`,
      ),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
          decision: args.decision,
          reason: args.reason,
        }),
      },
    ),
  );
}
