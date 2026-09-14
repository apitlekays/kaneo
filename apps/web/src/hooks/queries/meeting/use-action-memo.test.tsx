import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSendActionMemo } from "./use-action-memo";

vi.mock("@/fetchers/meeting", () => ({
  sendActionMemo: vi.fn().mockResolvedValue({ id: "memo-1" }),
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useSendActionMemo("ws-1", "meeting-1", "action-1"),
    { wrapper },
  );
  return { result, invalidate };
}

describe("useSendActionMemo", () => {
  it("invalidates the memo context query for this action after a successful send, so lastSend refreshes without a reload", async () => {
    const { result, invalidate } = setup();

    result.current.mutate({
      recipientName: "Jane",
      recipientEmail: "jane@example.com",
      bodyMarkdown: "Hello",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["meeting-action-memo", "ws-1", "meeting-1", "action-1"],
    });
  });
});
