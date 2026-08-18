import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLetterMutations } from "./use-letters";

vi.mock("@/fetchers/correspondence/letters", () => ({
  acceptAssignment: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useLetterMutations("ws-1", "letter-1"), {
    wrapper,
  });
  return { result, invalidate };
}

describe("useLetterMutations", () => {
  it("refreshes the GM awaiting-acceptance watchlist after a decision", async () => {
    // Nothing else invalidates this key, so a GM leaving the page mounted would
    // watch a list that never changes.
    const { result, invalidate } = setup();

    result.current.acceptAssignment.mutate("assign-1");

    await waitFor(() =>
      expect(result.current.acceptAssignment.isSuccess).toBe(true),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["awaiting-acceptance", "ws-1"],
    });
  });
});
