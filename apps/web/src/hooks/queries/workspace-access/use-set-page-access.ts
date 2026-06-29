import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type PageAccessGrant,
  setPageAccess,
} from "@/fetchers/workspace-access";

type Vars = { userId: string; pageSlug: string; allowed: boolean };
type MatrixData = { grants: PageAccessGrant[] };

/** Toggle one matrix cell with optimistic update (owner/global-admin only). */
export function useSetPageAccess(workspaceId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["page-access", "matrix", workspaceId];

  return useMutation({
    mutationFn: ({ userId, pageSlug, allowed }: Vars) =>
      setPageAccess(workspaceId, userId, pageSlug, allowed),
    onMutate: async ({ userId, pageSlug, allowed }: Vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MatrixData>(queryKey);
      queryClient.setQueryData<MatrixData>(queryKey, (old) => {
        const grants = (old?.grants ?? []).filter(
          (grant) => !(grant.userId === userId && grant.pageSlug === pageSlug),
        );
        if (allowed) grants.push({ userId, pageSlug });
        return { grants };
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
