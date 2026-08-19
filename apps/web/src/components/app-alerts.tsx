import { useCallback, useEffect, useMemo, useRef } from "react";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { useChimePreference } from "@/hooks/use-chime-preference";
import { useUnseenAlerts } from "@/hooks/use-notification-alerts";
import { createChime } from "@/lib/play-chime";
import { toast } from "@/lib/toast";

type Notified = { id: string; title: string | null; type: string };

/**
 * Mounted once for the whole app. Every module that calls createNotification
 * on the API gets a toast and a chime from here — no module writes alert code
 * of its own.
 */
export function AppAlerts() {
  const { data } = useGetNotifications();
  const { muted } = useChimePreference();

  // One Audio element for the session, read through a ref: rebuilding it on
  // every mute toggle would throw away the element the unlock below primed.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const chime = useMemo(
    () =>
      createChime({
        isMuted: () => mutedRef.current,
        audio: new Audio("/chime.wav"),
      }),
    [],
  );

  // Browsers refuse audio until the page has seen a user gesture, so the first
  // real chime of a session would be swallowed. Spend the first click on an
  // inaudible unlock instead.
  const unlockedRef = useRef(false);
  useEffect(() => {
    if (unlockedRef.current) return;
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      chime.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [chime]);

  const onUnseen = useCallback(
    (items: Notified[]) => {
      // One chime per burst, never one per item.
      chime.play();
      if (items.length === 1) {
        const only = items[0];
        toast.info(only.title ?? only.type);
        return;
      }
      toast.info(`${items.length} new notifications`);
    },
    [chime],
  );

  // Map rather than cast: `data` comes from the hono client, whose inferred
  // row type carries more fields and may serialise them differently. Mapping
  // to exactly what the alert needs keeps this honest if that type shifts.
  const items = useMemo(
    () =>
      data?.map((n) => ({
        id: String(n.id),
        title: n.title ?? null,
        type: n.type,
      })) as Notified[] | undefined,
    [data],
  );

  // Never default to [] here: the hook seeds its "seen" set from the first
  // non-undefined list. Passing [] while the query is loading would seed an
  // empty set, then announce every existing notification as new.
  useUnseenAlerts(items, onUnseen);

  return null;
}
