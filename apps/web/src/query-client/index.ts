import { QueryClient } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refresh on tab refocus and on mount so navigating to a previously
      // visited view (e.g. Home after creating a task) shows current data.
      // staleTime is 0, so these are background refetches — cached data renders
      // immediately and is replaced when the fresh result arrives (no spinner).
      // The WebSocket layer keeps already-open views live; these cover the
      // "open/return to a view" cases the sockets can't.
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: (failureCount, error) => {
        if (error instanceof Error) {
          if (
            error.message.includes("Failed to fetch") ||
            error.message.includes("NetworkError") ||
            error.message.includes("CORS")
          ) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export default queryClient;
