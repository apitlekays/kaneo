import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/fetchers/asset-registry";
import { toast } from "@/lib/toast";

/**
 * All asset mutations for a workspace (and optionally a focused asset, needed
 * for sub-resource mutations). Each invalidates the list, summary, and detail
 * caches so the acting user's own views update instantly (the realtime
 * websocket covers other users).
 */
export function useAssetMutations(workspaceId: string, assetId?: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["assets", workspaceId] });
    qc.invalidateQueries({ queryKey: ["asset-summary", workspaceId] });
    if (assetId) {
      qc.invalidateQueries({ queryKey: ["asset", workspaceId, assetId] });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  const asset = assetId as string;

  return {
    create: useMutation({
      mutationFn: (data: api.AssetInput) => api.createAsset(workspaceId, data),
      onSuccess: () => {
        invalidate();
        toast.success("Asset registered");
      },
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: api.AssetInput }) =>
        api.updateAsset(workspaceId, id, data),
      onSuccess: () => {
        invalidate();
        toast.success("Asset updated");
      },
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteAsset(workspaceId, id),
      onSuccess: () => {
        invalidate();
        toast.success("Asset deleted");
      },
      onError,
    }),

    addRenewal: useMutation({
      mutationFn: (body: Partial<api.AssetRenewal>) =>
        api.addRenewal(workspaceId, asset, body),
      onSuccess: invalidate,
      onError,
    }),
    removeRenewal: useMutation({
      mutationFn: (id: string) => api.deleteRenewal(workspaceId, asset, id),
      onSuccess: invalidate,
      onError,
    }),

    addMaintenance: useMutation({
      mutationFn: (body: Partial<api.AssetMaintenance>) =>
        api.addMaintenance(workspaceId, asset, body),
      onSuccess: invalidate,
      onError,
    }),
    removeMaintenance: useMutation({
      mutationFn: (id: string) => api.deleteMaintenance(workspaceId, asset, id),
      onSuccess: invalidate,
      onError,
    }),

    addCost: useMutation({
      mutationFn: (body: Partial<api.AssetCost>) =>
        api.addCost(workspaceId, asset, body),
      onSuccess: invalidate,
      onError,
    }),
    removeCost: useMutation({
      mutationFn: (id: string) => api.deleteCost(workspaceId, asset, id),
      onSuccess: invalidate,
      onError,
    }),

    addTrip: useMutation({
      mutationFn: (body: Partial<api.AssetTrip>) =>
        api.addTrip(workspaceId, asset, body),
      onSuccess: invalidate,
      onError,
    }),
    removeTrip: useMutation({
      mutationFn: (id: string) => api.deleteTrip(workspaceId, asset, id),
      onSuccess: invalidate,
      onError,
    }),

    uploadFile: useMutation({
      mutationFn: (file: File) => api.uploadAssetFile(workspaceId, asset, file),
      onSuccess: invalidate,
      onError,
    }),
    removeFile: useMutation({
      mutationFn: (id: string) => api.deleteAssetFile(workspaceId, asset, id),
      onSuccess: invalidate,
      onError,
    }),

    setCustodian: useMutation({
      mutationFn: ({
        targetAssetId,
        userId,
        note,
      }: {
        targetAssetId: string;
        userId: string;
        note?: string;
      }) => api.setCustodian(workspaceId, targetAssetId, userId, note),
      onSuccess: () => {
        invalidate();
        toast.success("Custodian assigned");
      },
      onError,
    }),
    releaseCustodian: useMutation({
      mutationFn: (targetAssetId: string) =>
        api.releaseCustodian(workspaceId, targetAssetId),
      onSuccess: () => {
        invalidate();
        toast.success("Custodian released");
      },
      onError,
    }),

    createDisposal: useMutation({
      mutationFn: (body: api.DisposalInput) =>
        api.createDisposal(workspaceId, asset, body),
      onSuccess: () => {
        invalidate();
        toast.success("Asset disposed");
      },
      onError,
    }),
    removeDisposal: useMutation({
      mutationFn: () => api.deleteDisposal(workspaceId, asset),
      onSuccess: () => {
        invalidate();
        toast.success("Disposal reverted");
      },
      onError,
    }),

    addPmSchedule: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        api.addPmSchedule(workspaceId, asset, body),
      onSuccess: invalidate,
      onError,
    }),
    updatePmSchedule: useMutation({
      mutationFn: ({
        scheduleId,
        body,
      }: {
        scheduleId: string;
        body: Record<string, unknown>;
      }) => api.updatePmSchedule(workspaceId, asset, scheduleId, body),
      onSuccess: invalidate,
      onError,
    }),
    removePmSchedule: useMutation({
      mutationFn: (scheduleId: string) =>
        api.deletePmSchedule(workspaceId, asset, scheduleId),
      onSuccess: invalidate,
      onError,
    }),
    createWorkOrder: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        api.createWorkOrder(workspaceId, asset, body),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["work-orders", workspaceId] });
        toast.success("Work order created");
      },
      onError,
    }),
  };
}
