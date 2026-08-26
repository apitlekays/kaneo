import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import {
  settleBackgroundWork,
  trackBackgroundWork,
} from "../utils/background-work";

const EVENTS = new EventEmitter();
EVENTS.setMaxListeners(100);
export const eventContext = new AsyncLocalStorage<{ initiatorId: string }>();

/**
 * Waits for all currently in-flight event handler invocations to settle,
 * including any further events they publish while settling — and, since
 * handler promises are registered in the shared background-work tracker,
 * any other background work (e.g. notification delivery) that was in flight
 * too. Intended for test harnesses that need to know handler side effects
 * (e.g. DB writes) are complete before proceeding. Does not affect
 * production behaviour — `publishEvent` never awaits this.
 *
 * Kept as a thin alias over `settleBackgroundWork` so existing callers and
 * this module's own tests don't need to change.
 */
export async function settlePendingEvents(): Promise<void> {
  await settleBackgroundWork();
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

      trackBackgroundWork(settled);
    });
  } catch (error) {
    console.error("Failed to subscribe to event:", error);
    throw error;
  }
}

process.on("SIGTERM", () => {
  shutdownEventBus().catch(console.error);
});
