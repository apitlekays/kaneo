import { useInfiniteQuery } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";

/**
 * The Meeting Minutes library: newest first, one page at a time.
 *
 * `q` is part of the query key, so changing the search term starts a fresh
 * pagination rather than appending matches to the previous term's pages.
 */
export function useMeetings(workspaceId: string, q?: string) {
  return useInfiniteQuery({
    queryKey: ["meetings", workspaceId, { q: q ?? "" }],
    queryFn: ({ pageParam }) =>
      api.listMeetings(workspaceId, {
        q: q || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!workspaceId,
  });
}
