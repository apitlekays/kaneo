import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LetterMinute } from "@/fetchers/correspondence/letters";
import { MinuteThread } from "./minute-thread";

// Mock the mutation hook — this suite is about the thread's rendering and
// composer behaviour, not the network/invalidation contract (that's
// use-letters' minute-update-invalidation.test.tsx).
const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useAddMinuteUpdate: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
  }),
}));

// Mirrors the mock used in correspondence.test.tsx for the same hook — the
// thread resolves author display names independently of its parent.
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "user-1", user: { name: "Alice Officer" } },
          { userId: "user-2", user: { name: "Bob Assignee" } },
        ],
      },
    }),
  }),
);

function makeMinute(overrides: Partial<LetterMinute> = {}): LetterMinute {
  return {
    id: "minute-1",
    letterId: "letter-1",
    authorId: "user-1",
    body: "Please review",
    actionType: null,
    assigneeId: "user-2",
    dueAt: null,
    status: "open",
    completedAt: null,
    completedBy: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updates: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.isPending = false;
});

describe("MinuteThread", () => {
  it("renders existing updates oldest-first, each showing its body", () => {
    // The API already returns updates oldest-first — the thread must render
    // them in the order it receives them, not re-sort defensively.
    const minute = makeMinute({
      updates: [
        {
          id: "update-1",
          minuteId: "minute-1",
          authorId: "user-2",
          body: "Started drafting the response",
          createdAt: "2025-01-02T00:00:00.000Z",
        },
        {
          id: "update-2",
          minuteId: "minute-1",
          authorId: "user-1",
          body: "Please attach the annex too",
          createdAt: "2025-01-03T00:00:00.000Z",
        },
      ],
    });

    render(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    const bodies = screen.getAllByText(
      /Started drafting the response|Please attach the annex too/,
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveTextContent("Started drafting the response");
    expect(bodies[1]).toHaveTextContent("Please attach the annex too");
    // Author and date are shown alongside each update.
    expect(screen.getByText("Bob Assignee")).toBeVisible();
    expect(screen.getByText("Alice Officer")).toBeVisible();
  });

  it("submitting a non-empty update calls the mutation with that text", async () => {
    const user = userEvent.setup();
    const minute = makeMinute({ updates: [] });

    render(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Draft sent to the ministry",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenCalledWith(
      {
        minuteId: "minute-1",
        body: "Draft sent to the ministry",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("disables the submit control while the body is empty or whitespace-only", async () => {
    const user = userEvent.setup();
    const minute = makeMinute({ updates: [] });

    render(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    const submit = screen.getByRole("button", { name: /post update/i });
    // Empty body.
    expect(submit).toBeDisabled();

    // Whitespace-only body.
    await user.type(screen.getByPlaceholderText(/post an update/i), "   ");
    expect(submit).toBeDisabled();

    // Non-empty body enables it.
    await user.type(screen.getByPlaceholderText(/post an update/i), "ok");
    expect(submit).not.toBeDisabled();
  });

  it("renders the composer but no thread rows, and no empty-state error, for a minute with no updates", () => {
    const minute = makeMinute({ updates: [] });

    render(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    // The composer is present.
    expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /post update/i }),
    ).toBeInTheDocument();
    // No error/empty-state copy of any kind.
    expect(screen.queryByText(/no updates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it("does not render a composer when canPost is false", () => {
    const minute = makeMinute({ updates: [] });

    render(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost={false}
      />,
    );

    expect(
      screen.queryByPlaceholderText(/post an update/i),
    ).not.toBeInTheDocument();
  });
});
