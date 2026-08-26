// Generalised tracker for fire-and-forget work started from a request that
// has already returned a response. `publishEvent` handlers were the first
// thing found doing this (see `events/index.ts`), but they are not the only
// layer: a handler can itself kick off further untracked work (e.g.
// `deliverNotification` inside `createNotification`), and that work can run
// DB queries that are still in flight when a test harness truncates tables
// between tests. Racing an in-flight SELECT/UPDATE against a wide TRUNCATE
// (which takes an AccessExclusiveLock) can deadlock — see
// `tests/api-integration/helpers/database.ts` for the concrete report.
//
// Anything — an event handler, a notification delivery, a webhook health
// write, a calendar sync, a label sync — that touches the database after its
// initiating request has already responded should register its promise here
// via `trackBackgroundWork`, so a caller that needs to know "is everything
// settled" (namely test harnesses, via `settleBackgroundWork`) actually can.
const PENDING_WORK = new Set<Promise<unknown>>();

// Bound on how many times `settleBackgroundWork` will loop draining newly
// added promises (tracked work can itself schedule more tracked work while
// we're waiting, e.g. a handler that publishes another event). This is a
// safety net against a pathological cycle that never quiesces — it should
// never be hit in practice.
const MAX_SETTLE_ITERATIONS = 1000;

/**
 * Registers a promise as in-flight background work. The promise is removed
 * from the tracked set once it settles, regardless of whether it resolves
 * or rejects — a rejecting promise must not poison future drains, and must
 * not produce an unhandled rejection warning here (the caller is expected to
 * handle/log the rejection itself, as fire-and-forget call sites already do).
 * Never awaited by callers in production code paths — only test harnesses
 * call `settleBackgroundWork` to wait for this set to drain.
 */
export function trackBackgroundWork(promise: Promise<unknown>): void {
  PENDING_WORK.add(promise);
  promise.then(
    () => {
      PENDING_WORK.delete(promise);
    },
    () => {
      PENDING_WORK.delete(promise);
    },
  );
}

/**
 * Waits for all currently in-flight tracked background work to settle,
 * including any further work it schedules while settling. Intended for test
 * harnesses that need to know background side effects (e.g. DB writes) are
 * complete before proceeding. Does not affect production behaviour — none of
 * the tracked call sites await this.
 */
export async function settleBackgroundWork(): Promise<void> {
  let iterations = 0;
  while (PENDING_WORK.size > 0) {
    if (iterations >= MAX_SETTLE_ITERATIONS) {
      throw new Error(
        `settleBackgroundWork: exceeded ${MAX_SETTLE_ITERATIONS} drain iterations without the pending work set emptying. ` +
          "This likely means tracked background work is stuck in a scheduling loop.",
      );
    }
    iterations++;
    await Promise.allSettled(Array.from(PENDING_WORK));
  }
}
