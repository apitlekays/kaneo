// The task API accepts only this fixed set of priority values. Fetchers that
// build request bodies from a `Task` (whose `priority` field is the wider
// `string | null` to stay easy to read from any API response) must narrow
// back down to this union before sending a request, rather than forwarding
// an arbitrary string.
export const TASK_PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Narrow a possibly-missing/possibly-invalid priority string down to a valid
 * `TaskPriority`, defaulting to `"no-priority"` — the same fallback the API
 * itself uses when no priority is supplied.
 */
export function toTaskPriority(
  priority: string | null | undefined,
): TaskPriority {
  return priority && (TASK_PRIORITIES as readonly string[]).includes(priority)
    ? (priority as TaskPriority)
    : "no-priority";
}
