import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAddActionUpdate,
  useMeetingMutations,
} from "./use-meeting-mutations";

const mockPostActionUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/meeting", () => ({
  updateMeeting: vi.fn().mockResolvedValue({}),
  addAttendee: vi.fn().mockResolvedValue({}),
  postActionUpdate: (...args: unknown[]) => mockPostActionUpdate(...args),
}));

const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: mockToastError },
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

function setupAddActionUpdate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAddActionUpdate("ws-1", "meeting-1"), {
    wrapper,
  });
  return { result };
}

beforeEach(() => {
  mockPostActionUpdate.mockReset();
  mockToastError.mockClear();
});

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

describe("useAddActionUpdate", () => {
  // A failed "Post update" used to produce nothing at all: no toast, no
  // inline error, and the composer still holding the user's text — visually
  // identical to a click that never registered, on the primary new action
  // of the whole feature. This is the only mutation in the file that lacked
  // the shared `onError`; the test drives the real hook (not a mocked
  // `mutate`) so it fails if that handler is ever dropped again.
  it("surfaces a failed post via toast, using the server's message", async () => {
    mockPostActionUpdate.mockRejectedValue(new Error("Not found"));
    const { result } = setupAddActionUpdate();

    result.current.mutate({ actionId: "action-1", body: "Progress" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockToastError).toHaveBeenCalledWith("Not found");
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    mockPostActionUpdate.mockRejectedValue("boom");
    const { result } = setupAddActionUpdate();

    result.current.mutate({ actionId: "action-1", body: "Progress" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockToastError).toHaveBeenCalledWith("Failed to post update");
  });
});
