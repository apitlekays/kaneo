import { useQuery } from "@tanstack/react-query";
import { getAssetSummary, listAssets } from "@/fetchers/asset-registry";

export function useAssets(workspaceId: string) {
  return useQuery({
    queryKey: ["assets", workspaceId],
    queryFn: () => listAssets(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useAssetSummary(workspaceId: string) {
  return useQuery({
    queryKey: ["asset-summary", workspaceId],
    queryFn: () => getAssetSummary(workspaceId),
    enabled: !!workspaceId,
  });
}
