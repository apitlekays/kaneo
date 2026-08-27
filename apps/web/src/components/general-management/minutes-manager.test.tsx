import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingListItem } from "@/fetchers/meeting";
import { MinutesManager } from "./minutes-manager";

// Mock the query hooks this component uses (read from the component's own
// imports rather than guessed paths), the same way correspondence.test.tsx
// does for its sibling manager.

const state = vi.hoisted(() => ({
  pages: [] as { items: MeetingListItem[]; nextCursor: string | null }[],
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
}));

const fetchNextPage = vi.hoisted(() => vi.fn());
const refetchMeetings = vi.hoisted(() => vi.fn());
const createMutate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/meeting/use-meetings", () => ({
  useMeetings: () => ({
    data: { pages: state.pages },
    isLoading: state.isLoading,
    isError: state.isError,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: state.isFetchingNextPage,
    fetchNextPage,
    refetch: refetchMeetings,
  }),
}));

vi.mock("@/hooks/queries/meeting/use-meeting-mutations", () => ({
  useMeetingMutations: () => ({
    create: { mutate: createMutate, isPending: false },
  }),
}));

vi.mock("./meeting-detail-dialog", () => ({
  // Renders the open meetingId (or nothing) so tests can observe whether a
  // click opened the meeting detail dialog, without pulling in useMeeting.
  MeetingDetailDialog: ({ meetingId }: { meetingId: string | null }) =>
    meetingId ? <div data-testid="detail-open">{meetingId}</div> : null,
}));

function makeMeeting(
  overrides: Partial<MeetingListItem> = {},
): MeetingListItem {
  return {
    id: "meeting-1",
    workspaceId: "ws-1",
    title: "Q3 Committee Meeting",
    meetingTypeId: "type-committee",
    bodyId: null,
    scheduledAt: "2026-03-01T12:00:00.000Z",
    location: null,
    confidential: false,
    status: "draft",
    adoptedAt: null,
    adoptedByMeetingId: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    meetingTypeLabel: "Committee Meeting",
    bodyName: null,
    ...overrides,
  };
}

afterEach(() => {
  state.pages = [];
  state.isLoading = false;
  state.isError = false;
  state.hasNextPage = false;
  state.isFetchingNextPage = false;
  createMutate.mockClear();
  refetchMeetings.mockClear();
  fetchNextPage.mockClear();
});

describe("MinutesManager", () => {
  it("1. renders each meeting's title, type and scheduled date", () => {
    state.pages = [
      {
        items: [
          makeMeeting({
            id: "meeting-1",
            title: "Q3 Committee Meeting",
            meetingTypeLabel: "Committee Meeting",
            scheduledAt: "2026-03-01T12:00:00.000Z",
          }),
        ],
        nextCursor: null,
      },
    ];

    render(<MinutesManager workspaceId="ws-1" />);

    expect(screen.getByText("Q3 Committee Meeting")).toBeVisible();
    expect(screen.getByText("Committee Meeting")).toBeVisible();
    // The exact day can shift by timezone; the year is the stable part of
    // the rendered, real (not hardcoded) formatted date.
    expect(screen.getByText(/2026/)).toBeVisible();
  });

  it("2. shows an honest empty state — no spinner, no error — when there are no meetings", () => {
    state.pages = [{ items: [], nextCursor: null }];
    state.isLoading = false;

    render(<MinutesManager workspaceId="ws-1" />);

    expect(screen.getByText("No Meeting Minutes yet")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it("3. creating a meeting calls the create mutation with the entered title, location and confidential flag", async () => {
    const user = userEvent.setup();
    state.pages = [{ items: [], nextCursor: null }];

    render(<MinutesManager workspaceId="ws-1" />);

    await user.click(screen.getByRole("button", { name: /new meeting/i }));
    await user.type(
      screen.getByPlaceholderText(/Q3 Committee Meeting/),
      "Board Meeting",
    );
    await user.type(screen.getByPlaceholderText(/optional/i), "Room 5");
    await user.click(screen.getByLabelText(/confidential/i));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(createMutate).toHaveBeenCalledWith(
      {
        title: "Board Meeting",
        scheduledAt: undefined,
        location: "Room 5",
        confidential: true,
      },
      expect.anything(),
    );
  });

  it("4. renders a visible confidential marker on a confidential meeting, and not on an ordinary one", () => {
    state.pages = [
      {
        items: [
          makeMeeting({
            id: "meeting-confidential",
            title: "Closed Session",
            confidential: true,
          }),
          makeMeeting({
            id: "meeting-open",
            title: "Open Session",
            confidential: false,
          }),
        ],
        nextCursor: null,
      },
    ];

    render(<MinutesManager workspaceId="ws-1" />);

    expect(screen.getAllByText("Confidential")).toHaveLength(1);
    const closedRow = screen.getByText("Closed Session").closest("button");
    const openRow = screen.getByText("Open Session").closest("button");
    expect(closedRow?.textContent).toContain("Confidential");
    expect(openRow?.textContent).not.toContain("Confidential");
  });

  it("5. a failed list load shows an error state distinguishable from empty and loading, with a retry", async () => {
    const user = userEvent.setup();
    state.pages = [];
    state.isLoading = false;
    state.isError = true;

    render(<MinutesManager workspaceId="ws-1" />);

    // Distinguishable from the empty state (finding C1: this used to render
    // the exact same "No Meeting Minutes yet" text as a genuinely empty
    // workspace).
    expect(screen.getByText(/couldn't load meeting minutes/i)).toBeVisible();
    expect(
      screen.queryByText("No Meeting Minutes yet"),
    ).not.toBeInTheDocument();
    // Distinguishable from loading.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetchMeetings).toHaveBeenCalled();
  });

  it("6. the loading state is announced to assistive tech", () => {
    state.isLoading = true;

    render(<MinutesManager workspaceId="ws-1" />);

    expect(screen.getByRole("status")).toBeVisible();
  });

  it("7. the New meeting dialog's Title, Scheduled date and Location inputs are labelled programmatically", async () => {
    const user = userEvent.setup();
    state.pages = [{ items: [], nextCursor: null }];

    render(<MinutesManager workspaceId="ws-1" />);
    await user.click(screen.getByRole("button", { name: /new meeting/i }));

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled date")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
  });

  it("distinguishes an empty workspace from an empty search", async () => {
    state.pages = [{ items: [], nextCursor: null }];
    render(<MinutesManager workspaceId="ws-1" />);
    expect(screen.getByText("No Meeting Minutes yet")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "nothing matches");
    expect(
      await screen.findByText("No Meeting Minutes matched"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear search/i }),
    ).toBeInTheDocument();
  });

  it("offers a way back from an empty search", async () => {
    state.pages = [{ items: [], nextCursor: null }];
    render(<MinutesManager workspaceId="ws-1" />);
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "zzz");
    await userEvent.click(
      await screen.findByRole("button", { name: /clear search/i }),
    );
    expect(search).toHaveValue("");
  });

  it("loads the next page exactly once when asked", async () => {
    state.pages = [{ items: [makeMeeting()], nextCursor: "next" }];
    state.hasNextPage = true;
    render(<MinutesManager workspaceId="ws-1" />);
    await userEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("hides the load-more control on the last page", () => {
    state.pages = [{ items: [makeMeeting()], nextCursor: null }];
    state.hasNextPage = false;
    render(<MinutesManager workspaceId="ws-1" />);
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("renders every page's meetings, not just the first", () => {
    state.pages = [
      {
        items: [makeMeeting({ id: "m1", title: "First page meeting" })],
        nextCursor: "c",
      },
      {
        items: [makeMeeting({ id: "m2", title: "Second page meeting" })],
        nextCursor: null,
      },
    ];
    render(<MinutesManager workspaceId="ws-1" />);
    expect(screen.getByText("First page meeting")).toBeInTheDocument();
    expect(screen.getByText("Second page meeting")).toBeInTheDocument();
  });

  it("keeps showing loaded cards while the next page is fetching", () => {
    state.pages = [
      { items: [makeMeeting({ title: "Already loaded" })], nextCursor: "c" },
    ];
    state.hasNextPage = true;
    state.isFetchingNextPage = true;
    render(<MinutesManager workspaceId="ws-1" />);
    expect(screen.getByText("Already loaded")).toBeInTheDocument();
    expect(screen.getByText(/loading more/i)).toBeInTheDocument();
  });
});
