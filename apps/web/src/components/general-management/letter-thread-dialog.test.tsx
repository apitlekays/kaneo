import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEntry } from "@/fetchers/correspondence/letters";
import { LetterThreadDialog } from "./letter-thread-dialog";

// Mock the thread query hook (mirrors correspondence.test.tsx's mock of the
// sibling hooks in the same module).
const state = vi.hoisted(() => ({
  thread: { letters: [] as ThreadEntry[], truncated: false },
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useLetterThread: () => ({ data: state.thread, isLoading: false }),
}));

function makeEntry(overrides: Partial<ThreadEntry>): ThreadEntry {
  return {
    id: "letter-default",
    refNo: "REF-1",
    externalRefNo: null,
    subject: "Default subject",
    direction: "in",
    date: "2025-01-01T00:00:00.000Z",
    isSeed: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("LetterThreadDialog", () => {
  it("lists the thread newest first with the current letter marked", async () => {
    // The API already sorts newest-first — the dialog must render them in
    // the order it receives them, not re-sort.
    state.thread = {
      letters: [
        makeEntry({
          id: "letter-newest",
          subject: "Newest reply",
          refNo: "REF-3",
        }),
        makeEntry({
          id: "letter-seed",
          subject: "Original letter",
          refNo: "REF-2",
          isSeed: true,
        }),
        makeEntry({
          id: "letter-oldest",
          subject: "Oldest letter",
          refNo: "REF-1",
        }),
      ],
      truncated: false,
    };

    render(
      <LetterThreadDialog
        workspaceId="ws-1"
        letterId="letter-seed"
        onClose={vi.fn()}
        onOpenLetter={vi.fn()}
      />,
    );

    const subjects = screen
      .getAllByText(/Newest reply|Original letter|Oldest letter/)
      .map((el) => el.textContent);
    expect(subjects).toEqual([
      "Newest reply",
      "Original letter",
      "Oldest letter",
    ]);

    // The seed entry is visually distinguished from the others.
    const seedRow = screen.getByText("Original letter").closest("li");
    const otherRow = screen.getByText("Newest reply").closest("li");
    expect(seedRow).toHaveTextContent(/this letter/i);
    expect(otherRow).not.toHaveTextContent(/this letter/i);
  });

  it("says so when the thread was truncated", () => {
    state.thread = {
      letters: [makeEntry({ id: "letter-a", isSeed: true })],
      truncated: true,
    };

    const { rerender } = render(
      <LetterThreadDialog
        workspaceId="ws-1"
        letterId="letter-a"
        onClose={vi.fn()}
        onOpenLetter={vi.fn()}
      />,
    );

    // M1: the walk is by link distance (BFS from the seed), not by date —
    // there's no ORDER BY on the edge query — so what survives the cap is
    // the letters nearest by link, not the newest. The banner must not
    // claim recency it doesn't have.
    expect(
      screen.getByText(
        "This thread was too long to show in full. Showing the 100 letters most closely linked to this one.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/most recent/i)).not.toBeInTheDocument();

    state.thread = {
      letters: [makeEntry({ id: "letter-a", isSeed: true })],
      truncated: false,
    };
    rerender(
      <LetterThreadDialog
        workspaceId="ws-1"
        letterId="letter-a"
        onClose={vi.fn()}
        onOpenLetter={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/too long to show in full/i),
    ).not.toBeInTheDocument();
  });

  it("shows the ERN for an incoming entry and the ref for an outgoing one", () => {
    state.thread = {
      letters: [
        makeEntry({
          id: "letter-in",
          direction: "in",
          refNo: "REF-IN",
          externalRefNo: "ERN-777",
          subject: "Incoming entry",
          isSeed: true,
        }),
        makeEntry({
          id: "letter-out",
          direction: "out",
          refNo: "REF-OUT-9",
          externalRefNo: null,
          subject: "Outgoing entry",
        }),
      ],
      truncated: false,
    };

    render(
      <LetterThreadDialog
        workspaceId="ws-1"
        letterId="letter-in"
        onClose={vi.fn()}
        onOpenLetter={vi.fn()}
      />,
    );

    // Same naming rule as the register: incoming shows the ERN, outgoing
    // shows our own ref number.
    expect(screen.getByText("ERN-777")).toBeVisible();
    expect(screen.getByText("REF-OUT-9")).toBeVisible();
  });

  it("opens the clicked entry's letter without navigating anywhere else", async () => {
    const user = userEvent.setup();
    state.thread = {
      letters: [
        makeEntry({ id: "letter-seed", subject: "Seed letter", isSeed: true }),
        makeEntry({ id: "letter-other", subject: "Other letter" }),
      ],
      truncated: false,
    };
    const onOpenLetter = vi.fn();

    render(
      <LetterThreadDialog
        workspaceId="ws-1"
        letterId="letter-seed"
        onClose={vi.fn()}
        onOpenLetter={onOpenLetter}
      />,
    );

    await user.click(screen.getByText("Other letter"));

    expect(onOpenLetter).toHaveBeenCalledWith("letter-other");
  });
});
