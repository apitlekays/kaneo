import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDriver,
  listDrivers,
  upsertDriver,
} from "@/fetchers/asset-registry";
import { toast } from "@/lib/toast";

export function useDrivers(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["drivers", workspaceId],
    queryFn: () => listDrivers(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

export function useDriverMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["drivers", workspaceId] });
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    save: useMutation({
      mutationFn: ({
        userId,
        body,
      }: {
        userId: string;
        body: Record<string, unknown>;
      }) => upsertDriver(workspaceId, userId, body),
      onSuccess: () => {
        invalidate();
        toast.success("Driver details saved");
      },
      onError,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => deleteDriver(workspaceId, userId),
      onSuccess: invalidate,
      onError,
    }),
  };
}
