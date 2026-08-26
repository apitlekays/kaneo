import { useQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

export function useMeeting(workspaceId: string, id: string | null) {
  return useQuery({
    queryKey: ["meeting", workspaceId, id],
    queryFn: () => api.getMeeting(workspaceId, id as string),
    enabled: !!workspaceId && !!id,
  });
}
