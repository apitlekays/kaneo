type Edge = { fromLetterId: string; toLetterId: string };

/**
 * Collects every letter reachable from the seed through links, in either
 * direction, so opening a thread from any letter in a chain shows the whole
 * chain. Links form a graph rather than a tree — two letters can reference
 * each other — so the visited set is what makes this terminate, and the cap
 * is what stops one accidental web of links becoming an unbounded query.
 */
export function walkThread(
  seedId: string,
  edges: Edge[],
  cap = 100,
): { ids: string[]; truncated: boolean } {
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const existing = neighbours.get(from);
    if (existing) existing.push(to);
    else neighbours.set(from, [to]);
  };
  for (const e of edges) {
    link(e.fromLetterId, e.toLetterId);
    link(e.toLetterId, e.fromLetterId);
  }

  const visited = new Set<string>([seedId]);
  const queue = [seedId];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of neighbours.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (visited.size >= cap) {
        truncated = true;
        break;
      }
      visited.add(next);
      queue.push(next);
    }
    if (truncated) break;
  }

  return { ids: [...visited], truncated };
}
