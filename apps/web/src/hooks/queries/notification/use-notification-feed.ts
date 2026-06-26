import { useQuery } from "@tanstack/react-query";
import { getNotificationFeed } from "@/fetchers/notification/get-feed";

export function useNotificationFeed() {
  return useQuery({
    queryKey: ["notification-feed"],
    queryFn: getNotificationFeed,
    // Keep the Home feed fresh even while the user sits on the page (the
    // per-user notifications aren't pushed over the workspace websocket).
    refetchInterval: 60_000,
  });
}
