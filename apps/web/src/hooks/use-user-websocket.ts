import { windowId } from "@kaneo/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

export function getUserWsUrl() {
  const base = getApiUrl("ws/user");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

/**
 * Always-on, user-scoped socket for cross-workspace events that can't reach the
 * recipient through a workspace channel — currently receiving an invitation.
 * Mounted at the authenticated layout so it covers every signed-in route.
 */
export function useUserWebSocket() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    retriesRef.current = 0;

    function connect() {
      const ws = new WebSocket(getUserWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "USER_SYNC") return;

          if (message.entity === "notification") {
            // Instant push for the Home activity feed + Home bell badge.
            queryClient.invalidateQueries({ queryKey: ["notification-feed"] });
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            return;
          }

          // Otherwise it's an inbound invitation.
          queryClient.invalidateQueries({ queryKey: ["invitations"] });
          queryClient.invalidateQueries({ queryKey: ["user-invitations"] });
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;

        if (retriesRef.current < MAX_RETRIES) {
          const delay = BASE_DELAY * 2 ** retriesRef.current; // 1s, 2s, 4s, 8s, 16s
          retriesRef.current += 1;
          timeoutRef.current = setTimeout(connect, delay);
        }
      };
    }
    connect();

    return () => {
      retriesRef.current = MAX_RETRIES; // Prevent reconnect after unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [userId, queryClient]);
}
