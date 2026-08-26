import { describe, expect, it } from "vitest";
import {
  settleBackgroundWork,
  trackBackgroundWork,
} from "../../../apps/api/src/utils/background-work";

// A real (short) macrotask delay, not just a microtask hop. This matters:
// `settleBackgroundWork()` itself is `async`, so even a broken *no-op*
// implementation still costs the caller one microtask tick via `await`. If
// the tracked work only needed a microtask to finish, that coincidental
// single tick could let a no-op `settleBackgroundWork` "win the race" and
// make the assertion pass for the wrong reason. Using a `setTimeout`-based
// delay means the work can only complete after a macrotask runs, so only a
// real implementation that actually awaits the tracked promise will observe
// it as done.
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("trackBackgroundWork / settleBackgroundWork", () => {
  it("is incomplete immediately after registering, and complete once settleBackgroundWork resolves", async () => {
    let completed = false;

    trackBackgroundWork(
      (async () => {
        await delay(20);
        completed = true;
      })(),
    );

    // trackBackgroundWork only registers the promise; it must not have
    // completed yet.
    expect(completed).toBe(false);

    await settleBackgroundWork();

    expect(completed).toBe(true);
  });

  it("awaits work that tracked work itself schedules during the drain", async () => {
    let innerCompleted = false;

    const outer = (async () => {
      // Registering `inner` here, synchronously within `outer`'s body,
      // mirrors a handler that kicks off further fire-and-forget work
      // (e.g. an event handler calling `createNotification`, which tracks
      // its own `deliverNotification` call).
      trackBackgroundWork(
        (async () => {
          await delay(20);
          innerCompleted = true;
        })(),
      );
    })();

    trackBackgroundWork(outer);

    // `outer` resolves almost immediately (no delay of its own), but
    // `inner` is still mid-delay, so it must not have completed yet even
    // once `outer` has settled.
    expect(innerCompleted).toBe(false);

    await settleBackgroundWork();

    expect(innerCompleted).toBe(true);
  });

  it("resolves even when a tracked promise rejects, and does not poison later drains", async () => {
    trackBackgroundWork(Promise.reject(new Error("boom")));

    await expect(settleBackgroundWork()).resolves.toBeUndefined();

    let ranAfter = false;
    trackBackgroundWork(
      (async () => {
        ranAfter = true;
      })(),
    );
    await settleBackgroundWork();

    expect(ranAfter).toBe(true);
  });
});
