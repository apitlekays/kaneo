import { afterEach, describe, expect, it } from "vitest";
import {
  publishEvent,
  settlePendingEvents,
  shutdownEventBus,
  subscribeToEvent,
} from "../../../apps/api/src/events/index";

// A real (short) macrotask delay, not just a microtask hop. This matters:
// `settlePendingEvents()` itself is `async`, so even a broken *no-op*
// implementation still costs the caller one microtask tick via `await`.
// If the handler under test only needed a microtask (e.g. resolving an
// already-created promise) to finish, that coincidental single tick could
// let a no-op `settlePendingEvents` "win the race" and make the assertion
// pass for the wrong reason. Using a `setTimeout`-based delay means the
// handler can only complete after a macrotask runs, so only a real
// implementation that actually awaits the handler's promise will observe
// it as done.
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("settlePendingEvents", () => {
  afterEach(async () => {
    await shutdownEventBus();
  });

  it("waits for an in-flight handler to complete, but publishEvent itself does not", async () => {
    let completed = false;

    await subscribeToEvent("test.settle.basic", async () => {
      await delay(20);
      completed = true;
    });

    await publishEvent("test.settle.basic", { foo: "bar" });

    // publishEvent returned already, but the handler is still mid-delay —
    // it must not have completed yet.
    expect(completed).toBe(false);

    await settlePendingEvents();

    expect(completed).toBe(true);
  });

  it("waits for events published from within a handler (nested publish)", async () => {
    let innerCompleted = false;

    await subscribeToEvent("test.settle.outer", async () => {
      // Publish the nested event; its handler is delayed below.
      await publishEvent("test.settle.inner", { nested: true });
    });

    await subscribeToEvent("test.settle.inner", async () => {
      await delay(20);
      innerCompleted = true;
    });

    await publishEvent("test.settle.outer", { start: true });

    // The nested handler is still mid-delay, so it must not have
    // completed yet, even though the outer publish already returned.
    expect(innerCompleted).toBe(false);

    await settlePendingEvents();

    expect(innerCompleted).toBe(true);
  });

  it("resolves even when a handler throws, and does not poison later calls", async () => {
    await subscribeToEvent("test.settle.throws", async () => {
      throw new Error("boom");
    });

    await publishEvent("test.settle.throws", { will: "throw" });

    await expect(settlePendingEvents()).resolves.toBeUndefined();

    // A subsequent, unrelated settle should still work fine.
    let ranAfter = false;
    await subscribeToEvent("test.settle.after-throw", async () => {
      ranAfter = true;
    });
    await publishEvent("test.settle.after-throw", {});
    await settlePendingEvents();

    expect(ranAfter).toBe(true);
  });
});
