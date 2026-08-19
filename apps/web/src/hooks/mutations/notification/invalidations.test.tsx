import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/fetchers/notification/clear-notifications", () => ({
  default: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/fetchers/notification/mark-all-notifications-as-read", () => ({
  default: vi.fn(async () => ({ success: true })),
}));

import useClearNotifications from "./use-clear-notifications";
import useMarkAllNotificationsAsRead from "./use-mark-all-notifications-as-read";

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
    (call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0],
  );
}

describe("notification mutations refresh every surface that reads them", () => {
  // The bell and the Home activity feed read the same rows under different
  // query keys. Invalidating only "notifications" leaves Home showing work
  // that is already cleared or read, for up to a minute.
  it("clearing notifications also refreshes the Home feed", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useClearNotifications(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining(["notifications", "notification-feed"]),
    );
  });

  it("marking all as read also refreshes the Home feed", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useMarkAllNotificationsAsRead(), {
      wrapper,
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining(["notifications", "notification-feed"]),
    );
  });
});
