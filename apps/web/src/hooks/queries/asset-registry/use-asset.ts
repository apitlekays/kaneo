import { useQuery } from "@tanstack/react-query";
import { getAsset } from "@/fetchers/asset-registry";

export function useAsset(workspaceId: string, id: string | null) {
  return useQuery({
    queryKey: ["asset", workspaceId, id],
    queryFn: () => getAsset(workspaceId, id as string),
    enabled: !!workspaceId && !!id,
  });
}
