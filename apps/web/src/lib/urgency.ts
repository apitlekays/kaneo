/**
 * Normal returns null on purpose: a grey "Normal" badge on every row is
 * visual noise that makes the urgent ones harder to spot, not easier.
 */
export function urgencyBadge(
  urgency: string,
): { label: string; variant: string } | null {
  return urgency === "urgent"
    ? { label: "Urgent", variant: "destructive" }
    : null;
}
