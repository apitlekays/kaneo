import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/fetchers/workspace-access", () => ({
  setGlobalAdmin: vi.fn(async () => ({ success: true })),
}));

import { useSetGlobalAdmin } from "./use-set-global-admin";

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

type InvalidateSpy = { mock: { calls: unknown[][] } };

function invalidatedKeys(invalidate: InvalidateSpy) {
  return invalidate.mock.calls.map(
    (call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
  );
}

describe("useSetGlobalAdmin refreshes every surface the toggle affects", () => {
  // The Access Management table reads the member list under its own key.
  // Without this invalidation the checkbox visually snaps back to its old
  // state after a successful toggle.
  it("invalidates the workspace members list", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useSetGlobalAdmin("ws-1"), {
      wrapper,
    });

    result.current.mutate({ userId: "user-1", enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([["workspace-members-list", "ws-1"]]),
    );
  });

  // The sidebar reads the current user's own page access under this key.
  // Without this invalidation, an admin who promotes/demotes themselves
  // keeps a stale sidebar.
  it("invalidates the caller's own page access", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useSetGlobalAdmin("ws-1"), {
      wrapper,
    });

    result.current.mutate({ userId: "user-1", enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([["page-access", "me", "ws-1"]]),
    );
  });
});
