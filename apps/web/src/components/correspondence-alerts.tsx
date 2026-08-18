import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useAssignmentAlerts } from "@/hooks/use-assignment-alerts";
import { useChimePreference } from "@/hooks/use-chime-preference";
import { createChime } from "@/lib/play-chime";
import { toast } from "@/lib/toast";

/**
 * Mounted once, workspace-agnostic: reads the active workspace itself so the
 * authenticated layout (which has no workspace in scope) can mount it as
 * <CorrespondenceAlerts /> alongside useUserWebSocket().
 */
export function CorrespondenceAlerts() {
  const { data: workspace } = useActiveWorkspace();
  const { data } = useMyCorrespondence(workspace?.id ?? "");
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

  const onNew = useCallback(
    (assignment: { refNo: string | null; subject: string }) => {
      chime.play();
      toast.info(
        `New correspondence: ${assignment.refNo ?? assignment.subject}`,
      );
    },
    [chime],
  );

  // Never default to [] here: the hook seeds its "seen" set from the first
  // non-undefined list. Passing [] while the query is loading would seed an
  // empty set, then announce the entire real list as "new" once it arrives.
  useAssignmentAlerts(data?.pendingAssignments, onNew);

  // Renders nothing either way; the explicit check documents that this is a
  // no-op (no query enabled, nothing to alert on) when no workspace is active.
  if (!workspace) return null;
  return null;
}
