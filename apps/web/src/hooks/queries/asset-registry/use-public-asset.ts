import { useQuery } from "@tanstack/react-query";
import { getPublicAsset } from "@/fetchers/asset-registry";

export function usePublicAsset(id: string) {
  return useQuery({
    queryKey: ["public-asset", id],
    queryFn: () => getPublicAsset(id),
    enabled: !!id,
    retry: false,
  });
}
