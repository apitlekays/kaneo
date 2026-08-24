import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";

const EVENTS = new EventEmitter();
EVENTS.setMaxListeners(100);
export const eventContext = new AsyncLocalStorage<{ initiatorId: string }>();

// Tracks in-flight event handler promises. `publishEvent` is fire-and-forget
// (EventEmitter#emit doesn't await async listeners), so handler DB work can
// still be running after the publishing request has already returned. Tests
// need a way to wait for that work to finish before doing anything that
// could race it (e.g. truncating tables) — see `settlePendingEvents`.
const PENDING_HANDLERS = new Set<Promise<void>>();

// Bound on how many times `settlePendingEvents` will loop draining newly
// added promises (handlers can publish further events, which adds more
// pending promises while we're waiting). This is just a safety net against
// a pathological publish-in-handler cycle that never quiesces — it should
// never be hit in practice.
const MAX_SETTLE_ITERATIONS = 1000;

/**
 * Waits for all currently in-flight event handler invocations to settle,
 * including any further events they publish while settling. Intended for
 * test harnesses that need to know handler side effects (e.g. DB writes)
 * are complete before proceeding. Does not affect production behaviour —
 * `publishEvent` never awaits this.
 */
export async function settlePendingEvents(): Promise<void> {
  let iterations = 0;
  while (PENDING_HANDLERS.size > 0) {
    if (iterations >= MAX_SETTLE_ITERATIONS) {
      throw new Error(
        `settlePendingEvents: exceeded ${MAX_SETTLE_ITERATIONS} drain iterations without the pending handler set emptying. ` +
          "This likely means an event handler is stuck in a publish loop.",
      );
    }
    iterations++;
    await Promise.allSettled(Array.from(PENDING_HANDLERS));
  }
}

export type EventPayload<T = unknown> = {
  type: string;
  data: T;
  timestamp: string;
};

export async function shutdownEventBus(): Promise<void> {
  EVENTS.removeAllListeners();
}

export async function publishEvent(
  eventType: string,
  data: unknown,
): Promise<void> {
  let enhancedData = null;
  if (typeof data === "object" && data !== null) {
    const store = eventContext.getStore();
    enhancedData = { ...data, initiatorId: store?.initiatorId };
  }

  const payload: EventPayload = {
    type: eventType,
    data: enhancedData || data,
    timestamp: new Date().toISOString(),
  };

  try {
    EVENTS.emit(eventType, payload);
  } catch (error) {
    console.error("Failed to publish event:", error);
    throw error;
  }
}

export async function subscribeToEvent<T>(
  eventType: string,
  handler: (data: T) => Promise<void>,
): Promise<void> {
  try {
    EVENTS.on(eventType, (payload: EventPayload<T>) => {
      const settled = (async () => {
        try {
          await handler(payload.data);
        } catch (error) {
          console.error(`Error processing event ${eventType}:`, error);
        }
      })();

      PENDING_HANDLERS.add(settled);
      settled.finally(() => {
        PENDING_HANDLERS.delete(settled);
      });
    });
  } catch (error) {
    console.error("Failed to subscribe to event:", error);
    throw error;
  }
}

process.on("SIGTERM", () => {
  shutdownEventBus().catch(console.error);
});
