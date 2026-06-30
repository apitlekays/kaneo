import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeAuditSession,
  createAuditSession,
  deleteAuditSession,
  getAuditSession,
  listAuditSessions,
  scanAudit,
} from "@/fetchers/asset-registry";
import { toast } from "@/lib/toast";

export function useAuditSessions(workspaceId: string) {
  return useQuery({
    queryKey: ["audit-sessions", workspaceId],
    queryFn: () => listAuditSessions(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useAuditSession(workspaceId: string, sessionId: string | null) {
  return useQuery({
    queryKey: ["audit-session", workspaceId, sessionId],
    queryFn: () => getAuditSession(workspaceId, sessionId as string),
    enabled: !!workspaceId && !!sessionId,
  });
}

export function useStockTakeMutations(workspaceId: string, sessionId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["audit-sessions", workspaceId] });
    if (sessionId) {
      qc.invalidateQueries({
        queryKey: ["audit-session", workspaceId, sessionId],
      });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );

  return {
    start: useMutation({
      mutationFn: (name: string) => createAuditSession(workspaceId, name),
      onSuccess: invalidate,
      onError,
    }),
    scan: useMutation({
      mutationFn: (serial: string) =>
        scanAudit(workspaceId, sessionId as string, serial),
      onSuccess: invalidate,
      onError,
    }),
    close: useMutation({
      mutationFn: () => closeAuditSession(workspaceId, sessionId as string),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteAuditSession(workspaceId, id),
      onSuccess: invalidate,
      onError,
    }),
  };
}
