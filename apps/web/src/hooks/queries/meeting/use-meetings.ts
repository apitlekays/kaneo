import { useQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

export function useMeetings(workspaceId: string) {
  return useQuery({
    queryKey: ["meetings", workspaceId],
    queryFn: () => api.listMeetings(workspaceId),
    enabled: !!workspaceId,
  });
}
