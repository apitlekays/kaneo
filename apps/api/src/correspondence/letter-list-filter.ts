/**
 * Which letters a register query should return.
 *
 * Disposed records stay in the database and keep their reference number — the
 * register must not gain a gap — but they drop out of the working list. The
 * disposed view asks for them explicitly.
 *
 * `archived` is deliberately untouched: a `permanent` disposition sets that
 * status, and a record marked to keep forever belongs in the register.
 */
export const DISPOSED_STATUS = "disposed";

export type StatusPredicate = {
  kind: "equals" | "excludes";
  status: string;
};

export function letterStatusFilter(opts: {
  status?: string;
  disposed?: boolean;
}): StatusPredicate {
  if (opts.disposed) return { kind: "equals", status: DISPOSED_STATUS };
  if (opts.status) return { kind: "equals", status: opts.status };
  return { kind: "excludes", status: DISPOSED_STATUS };
}

/**
 * Statuses that take a letter out of a user's active work feed. `disposed`
 * belongs here for the same reason it leaves the register: the record still
 * exists, but nobody is expected to act on it.
 */
export const INACTIVE_LETTER_STATUSES = [
  "closed",
  "archived",
  DISPOSED_STATUS,
] as const;
