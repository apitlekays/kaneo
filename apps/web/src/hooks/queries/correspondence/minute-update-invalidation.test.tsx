import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/fetchers/correspondence/letters", async () => {
  const actual = await vi.importActual<
    typeof import("@/fetchers/correspondence/letters")
  >("@/fetchers/correspondence/letters");
  return {
    ...actual,
    addMinuteUpdate: vi.fn(async () => ({
      id: "update-1",
      minuteId: "minute-1",
      authorId: "user-1",
      body: "Noted",
      createdAt: new Date().toISOString(),
    })),
  };
});

import { useAddMinuteUpdate } from "./use-letters";

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { invalidate, wrapper };
}

describe("posting a minute update refreshes the letter thread", () => {
  it("invalidates the letter detail query so the thread shows the new update", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(
      () => useAddMinuteUpdate("ws-1", "letter-1"),
      { wrapper },
    );

    result.current.mutate({ minuteId: "minute-1", body: "Noted" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["letter", "ws-1", "letter-1"] }),
    );
  });
});
