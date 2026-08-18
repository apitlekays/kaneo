import { useEffect, useRef } from "react";

export function unseenIds(
  seen: Set<string>,
  items: { id: string }[],
): string[] {
  return items.filter((i) => !seen.has(i.id)).map((i) => i.id);
}

/**
 * Announces items the user has not seen yet. The seen set is seeded from the
 * first list received, so a page load or a socket reconnect stays silent and
 * only genuinely new work interrupts anyone.
 *
 * The callback receives the whole batch rather than one item at a time: a
 * burst of notifications should cost one chime, not one per item.
 */
export function useUnseenAlerts<T extends { id: string }>(
  items: T[] | undefined,
  onUnseen: (items: T[]) => void,
) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const ids = unseenIds(seen.current, items);
    if (ids.length === 0) return;
    for (const id of ids) seen.current.add(id);
    onUnseen(items.filter((i) => ids.includes(i.id)));
  }, [items, onUnseen]);
}
