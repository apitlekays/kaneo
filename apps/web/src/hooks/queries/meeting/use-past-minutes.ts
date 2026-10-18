import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";
import { toast } from "@/lib/toast";

/**
 * Past Minutes, one page at a time. Every filter is part of the query key,
 * so changing one starts a fresh pagination rather than appending to the
 * previous filter's pages.
 */
export function usePastMinutes(
  workspaceId: string,
  filters: api.PastMinutesFilters,
) {
  return useInfiniteQuery({
    queryKey: ["past-minutes", workspaceId, filters],
    queryFn: ({ pageParam }) =>
      api.listPastMinutes(workspaceId, {
        ...filters,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!workspaceId,
  });
}

export function useMeetingArchivists(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["meeting-archivists", workspaceId],
    queryFn: () => api.listMeetingArchivists(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

const errorToast = (fallback: string) => (error: unknown) =>
  toast.error(
    error instanceof Error && error.message ? error.message : fallback,
  );

export function usePastMinuteMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = (meetingId?: string) => {
    qc.invalidateQueries({ queryKey: ["past-minutes", workspaceId] });
    if (meetingId)
      qc.invalidateQueries({ queryKey: ["meeting", workspaceId, meetingId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: api.PastMinuteInput) =>
        api.createPastMinute(workspaceId, body),
      onSuccess: () => invalidate(),
      onError: errorToast("Couldn't save the past minute"),
    }),
    update: useMutation({
      mutationFn: (vars: { id: string; body: api.PastMinuteInput }) =>
        api.updatePastMinute(workspaceId, vars.id, vars.body),
      onSuccess: (_row, vars) => invalidate(vars.id),
      onError: errorToast("Couldn't save the changes"),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deletePastMinute(workspaceId, id),
      onSuccess: () => invalidate(),
      onError: errorToast("Couldn't remove the past minute"),
    }),
  };
}

export function useArchivistMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["meeting-archivists", workspaceId] });
    qc.invalidateQueries({ queryKey: ["past-minutes", workspaceId] });
  };
  return {
    add: useMutation({
      mutationFn: (userId: string) =>
        api.addMeetingArchivist(workspaceId, userId),
      onSuccess: invalidate,
      onError: errorToast("Couldn't add that archivist"),
    }),
    remove: useMutation({
      mutationFn: (userId: string) =>
        api.removeMeetingArchivist(workspaceId, userId),
      onSuccess: invalidate,
      onError: errorToast("Couldn't remove that archivist"),
    }),
  };
}
