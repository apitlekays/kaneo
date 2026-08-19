import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDecidePending } from "./use-decide-pending";

const decidePending = vi.fn();
vi.mock("@/fetchers/pending-decision", () => ({
  decidePending: (...args: unknown[]) => decidePending(...args),
}));

describe("useDecidePending", () => {
  beforeEach(() => {
    decidePending.mockReset().mockResolvedValue(undefined);
  });

  it("refreshes every surface that shows the same pending item", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useDecidePending("ws-1"), { wrapper });
    result.current.mutate({
      source: "correspondence",
      id: "l1:a1",
      decision: "accepted",
      reason: null,
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["pending-decisions", "ws-1"]);
    expect(keys).toContainEqual(["awaiting-acceptance", "ws-1"]);
    expect(keys).toContainEqual(["my-correspondence", "ws-1"]);
    // Mirrors the letter-page mutation's invalidations (use-letters.ts), so
    // the letter page beneath the dialog can't keep serving a stale Accept
    // button after the dialog already resolved the decision.
    expect(keys).toContainEqual(["letters", "ws-1"]);
    expect(keys).toContainEqual(["correspondence-summary", "ws-1"]);
    expect(keys).toContainEqual(["letter", "ws-1"]);
  });
});
