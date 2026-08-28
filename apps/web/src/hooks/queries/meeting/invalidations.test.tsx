import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMeetingMutations } from "./use-meeting-mutations";

vi.mock("@/fetchers/meeting", () => ({
  updateMeeting: vi.fn().mockResolvedValue({}),
  addAttendee: vi.fn().mockResolvedValue({}),
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
  const { result } = renderHook(
    () => useMeetingMutations("ws-1", "meeting-1"),
    { wrapper },
  );
  return { result, invalidate };
}

function invalidatedKeys(invalidate: ReturnType<typeof setup>["invalidate"]) {
  return invalidate.mock.calls.map(
    (call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
  );
}

describe("useMeetingMutations", () => {
  it("refreshes both the list and the single-meeting detail after an update", async () => {
    const { result, invalidate } = setup();

    result.current.update.mutate({ title: "Renamed" });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        ["meetings", "ws-1"],
        ["meeting", "ws-1", "meeting-1"],
      ]),
    );
  });

  it("refreshes both keys after adding an attendee", async () => {
    const { result, invalidate } = setup();

    result.current.addAttendee.mutate({ name: "Guest" });

    await waitFor(() =>
      expect(result.current.addAttendee.isSuccess).toBe(true),
    );

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        ["meetings", "ws-1"],
        ["meeting", "ws-1", "meeting-1"],
      ]),
    );
  });
});
