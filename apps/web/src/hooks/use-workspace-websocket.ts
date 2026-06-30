import { windowId } from "@kaneo/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

export function getWorkspaceWsUrl(workspaceId: string) {
  const base = getApiUrl(`ws/workspace/${encodeURIComponent(workspaceId)}`);
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

/**
 * Maps a changed entity (the first path segment of the mutating API request,
 * e.g. `project`, `task`, `label`) to the React Query key prefixes that should
 * be invalidated. A partial key prefix invalidates every query that starts with
 * it (e.g. `["tasks"]` refreshes `["tasks", <projectId>]` for all projects).
 */
const ENTITY_INVALIDATIONS: Record<string, string[][]> = {
  project: [["projects"], ["my-tasks"], ["workspace"]],
  task: [["tasks"], ["my-tasks"], ["task"]],
  column: [["columns"], ["tasks"]],
  label: [["labels"], ["tasks"], ["my-tasks"]],
  comment: [["activities"], ["comments"]],
  activity: [["activities"]],
  "time-entry": [["time-entries"]],
  "task-relation": [["task-relations"], ["tasks"], ["task"]],
  "external-link": [["external-links"], ["tasks"]],
  "drive-attachment": [["drive-attachments"]],
  "task-mom": [["task-mom"], ["project-moms"]],
  notification: [["notifications"], ["notification-feed"]],
  "project-member": [
    ["project-members"],
    ["project-requests"],
    ["projects"],
    ["my-tasks"],
  ],
  "workflow-rule": [["workflow-rules"]],
  // Page-access toggles: refresh the affected user's own access (sidebar +
  // route guard) and, for any admin watching the matrix, the matrix + members.
  "workspace-access": [["page-access"], ["workspace-members-list"]],
  // Asset registry: refresh the list, any open detail, summary, work orders.
  "asset-registry": [
    ["assets"],
    ["asset"],
    ["asset-summary"],
    ["work-orders"],
    ["asset-locations"],
    ["audit-sessions"],
    ["audit-session"],
    ["drivers"],
    ["all-renewals"],
  ],
  workspace: [
    ["projects"],
    ["workspace"],
    ["active-workspace-users"],
    ["workspace-roles"],
    ["workspace-invites"],
  ],
  member: [
    ["active-workspace-users"],
    ["workspace"],
    ["workspace-roles"],
    ["workspace-invites"],
  ],
  invitation: [
    ["workspace-invites"],
    ["invitations"],
    ["user-invitations"],
    ["active-workspace-users"],
  ],
};

/**
 * Opens a single, always-on WebSocket to the active workspace channel and
 * invalidates the affected query caches whenever another user changes something
 * anywhere in the workspace. Mounted once at the dashboard layout so the whole
 * app stays live without a manual refresh.
 */
export function useWorkspaceWebSocket(workspaceId: string) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workspaceId || !session?.user?.id) return;

    retriesRef.current = 0;

    function connect() {
      const url = getWorkspaceWsUrl(workspaceId);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "WORKSPACE_SYNC" || !message.entity) return;

          const keys = ENTITY_INVALIDATIONS[message.entity] ?? [
            [message.entity],
            ["projects"],
            ["tasks"],
            ["my-tasks"],
          ];

          for (const queryKey of keys) {
            queryClient.invalidateQueries({ queryKey });
          }
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
  }, [workspaceId, session?.user?.id, queryClient]);
}
