import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteWorkOrder,
  listWorkOrders,
  updateWorkOrder,
} from "@/fetchers/asset-registry";
import { toast } from "@/lib/toast";

/** All work orders in a workspace (optionally filtered) — powers the kanban. */
export function useWorkOrders(
  workspaceId: string,
  params: { assigneeId?: string; status?: string } = {},
) {
  return useQuery({
    queryKey: ["work-orders", workspaceId, params],
    queryFn: () => listWorkOrders(workspaceId, params),
    enabled: !!workspaceId,
  });
}

/** Current user's open work orders — for the Home surfacing. */
export function useMyWorkOrders(workspaceId: string, userId?: string) {
  return useQuery({
    queryKey: ["work-orders", workspaceId, "mine", userId],
    queryFn: async () => {
      const all = await listWorkOrders(workspaceId, { assigneeId: userId });
      return all.filter((w) => w.status !== "done" && w.status !== "cancelled");
    },
    enabled: !!workspaceId && !!userId,
  });
}

/** Workspace-level work-order update/delete (used by the kanban). */
export function useWorkOrderMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["work-orders", workspaceId] });
    qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
    qc.invalidateQueries({ queryKey: ["asset", workspaceId] });
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    update: useMutation({
      mutationFn: ({
        woId,
        body,
      }: {
        woId: string;
        body: Record<string, unknown>;
      }) => updateWorkOrder(workspaceId, woId, body),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({
      mutationFn: (woId: string) => deleteWorkOrder(workspaceId, woId),
      onSuccess: () => {
        invalidate();
        toast.success("Work order deleted");
      },
      onError,
    }),
  };
}
