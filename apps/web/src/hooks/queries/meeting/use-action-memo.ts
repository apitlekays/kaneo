import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

/**
 * Shared with the mutation below so a successful send invalidates exactly
 * the query the Configure popup reads — otherwise `lastSend` would only
 * refresh on a reload.
 */
export const actionMemoKey = (
  workspaceId: string,
  meetingId: string,
  actionId: string,
) => ["meeting-action-memo", workspaceId, meetingId, actionId] as const;

/**
 * The Configure popup's single source of truth: default template, resolved
 * shortcode values, and the last send (if any) for one action. Disabled
 * until the popup is actually open and an action is selected — there is no
 * reason to hit the network for every action on the page up front.
 */
export function useActionMemo(
  workspaceId: string,
  meetingId: string,
  actionId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: actionMemoKey(workspaceId, meetingId, actionId),
    queryFn: () => api.getActionMemoContext(workspaceId, meetingId, actionId),
    enabled: enabled && !!workspaceId && !!meetingId && !!actionId,
  });
}

export function useSendActionMemo(
  workspaceId: string,
  meetingId: string,
  actionId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.SendMeetingActionMemoInput) =>
      api.sendActionMemo(workspaceId, meetingId, actionId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: actionMemoKey(workspaceId, meetingId, actionId),
      });
    },
  });
}
