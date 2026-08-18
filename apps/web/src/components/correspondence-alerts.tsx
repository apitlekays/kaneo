import { useCallback, useMemo } from "react";
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

  const chime = useMemo(
    () =>
      createChime({
        isMuted: () => muted,
        audio: new Audio("/chime.wav"),
      }),
    [muted],
  );

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
