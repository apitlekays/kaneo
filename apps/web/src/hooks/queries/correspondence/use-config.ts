import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ConfigBody,
  type ConfigItem,
  configResource,
} from "@/fetchers/correspondence";
import { toast } from "@/lib/toast";

export function useConfigList(resource: string, workspaceId: string) {
  return useQuery({
    queryKey: ["gm-config", resource, workspaceId],
    queryFn: () => configResource(resource).list(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useConfigMutations(resource: string, workspaceId: string) {
  const qc = useQueryClient();
  const api = configResource(resource);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["gm-config", resource, workspaceId] });
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    create: useMutation({
      mutationFn: (body: ConfigBody) => api.create(workspaceId, body),
      onSuccess: () => {
        invalidate();
        toast.success("Saved");
      },
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: ConfigBody }) =>
        api.update(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Saved");
      },
      onError,
    }),
    deactivate: useMutation({
      mutationFn: (id: string) => api.deactivate(workspaceId, id),
      onSuccess: () => {
        invalidate();
        toast.success("Removed");
      },
      onError,
    }),
  };
}

export type { ConfigItem };
