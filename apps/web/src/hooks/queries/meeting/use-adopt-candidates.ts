import { useQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

/**
 * Meetings offered as "the meeting at which these minutes were adopted".
 *
 * Deliberately NOT the paginated library hook. The picker needs one bounded
 * list, and silently showing only the newest page would make an older
 * meeting unselectable with nothing on screen to say why — so the picker
 * gets a search box instead, and this hook re-queries the server as the
 * user types.
 *
 * The key keeps the ["meetings", workspaceId] prefix so the existing
 * mutation invalidation refreshes it too.
 */
export function useAdoptCandidates(workspaceId: string, q?: string) {
  return useQuery({
    queryKey: ["meetings", workspaceId, "adopt-candidates", { q: q ?? "" }],
    queryFn: () =>
      api.listMeetings(workspaceId, { q: q || undefined, limit: 50 }),
    enabled: !!workspaceId,
  });
}
