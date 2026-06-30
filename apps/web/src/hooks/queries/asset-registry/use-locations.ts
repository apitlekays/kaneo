import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AssetLocation,
  createLocation,
  deleteLocation,
  listLocations,
} from "@/fetchers/asset-registry";
import { toast } from "@/lib/toast";

export function useLocations(workspaceId: string) {
  return useQuery({
    queryKey: ["asset-locations", workspaceId],
    queryFn: () => listLocations(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useLocationMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["asset-locations", workspaceId] });
    qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        createLocation(workspaceId, body),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({
      mutationFn: (locId: string) => deleteLocation(workspaceId, locId),
      onSuccess: invalidate,
      onError,
    }),
  };
}

/** Build "Site / Building / Room" path strings for each location id. */
export function buildLocationPaths(
  locations: AssetLocation[],
): Map<string, string> {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const paths = new Map<string, string>();
  const resolve = (id: string, seen = new Set<string>()): string => {
    if (paths.has(id)) return paths.get(id) as string;
    const loc = byId.get(id);
    if (!loc || seen.has(id)) return "";
    seen.add(id);
    const parent = loc.parentId ? resolve(loc.parentId, seen) : "";
    const path = parent ? `${parent} / ${loc.name}` : loc.name;
    paths.set(id, path);
    return path;
  };
  for (const l of locations) resolve(l.id);
  return paths;
}
