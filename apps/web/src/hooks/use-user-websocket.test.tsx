import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kaneo/libs", () => ({ windowId: "test-window-id" }));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

import { useUserWebSocket } from "./use-user-websocket";

type FakeSocket = {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  close: () => void;
};

let socket: FakeSocket;

beforeEach(() => {
  vi.stubGlobal(
    "WebSocket",
    class {
      close = vi.fn();
      constructor() {
        socket = this as unknown as FakeSocket;
      }
    },
  );
});

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useUserWebSocket(), { wrapper });
  return { invalidate };
}

describe("useUserWebSocket", () => {
  it("refreshes both the recipient's list and the GM watchlist on an assignment event", () => {
    const { invalidate } = setup();

    socket.onmessage?.({
      data: JSON.stringify({ type: "USER_SYNC", entity: "letter-assignment" }),
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["my-correspondence"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["awaiting-acceptance"],
    });
  });

  it("leaves the assignment queries alone for an invitation event", () => {
    const { invalidate } = setup();

    socket.onmessage?.({
      data: JSON.stringify({ type: "USER_SYNC", entity: "invitation" }),
    });

    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["awaiting-acceptance"],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invitations"] });
  });
});
