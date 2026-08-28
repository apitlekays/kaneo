import type { PendingDecisionItem, PendingDecisionProvider } from "./types";

/**
 * Fans out across every registered provider. One provider failing must not
 * blank the queue: a queue that quietly under-reports is worse than one that
 * admits it is incomplete, so the failed sources travel with the items.
 */
export async function collectPendingDecisions(
  providers: PendingDecisionProvider[],
  userId: string,
  workspaceId: string,
): Promise<{ items: PendingDecisionItem[]; failedSources: string[] }> {
  const settled = await Promise.allSettled(
    providers.map((p) => p.list(userId, workspaceId)),
  );

  const items: PendingDecisionItem[] = [];
  const failedSources: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
      return;
    }
    // `settled` is a 1:1 map over `providers`, so `providers[index]` always
    // exists; noUncheckedIndexedAccess can't see that from here.
    const source = providers[index]?.source ?? "unknown";
    failedSources.push(source);
    console.error(
      `pending-decision: provider "${source}" failed`,
      result.reason,
    );
  });

  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { items, failedSources };
}
