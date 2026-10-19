import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingListItem } from "@/fetchers/meeting";
import { PastMinutes } from "./past-minutes";

const state = vi.hoisted(() => ({
  items: [] as MeetingListItem[],
  canManage: false,
  isAdmin: false,
  lastFilters: null as unknown,
}));

vi.mock("@/hooks/queries/meeting/use-past-minutes", () => ({
  usePastMinutes: (_ws: string, filters: unknown) => {
    state.lastFilters = filters;
    return {
      data: {
        pages: [
          {
            items: state.items,
            nextCursor: null,
            pendingIndexCount: 0,
            canManage: state.canManage,
          },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ isAdmin: state.isAdmin }),
}));

vi.mock("@/fetchers/committees", () => ({
  listCommittees: () => Promise.resolve([]),
}));

vi.mock("@/fetchers/correspondence", () => ({
  configResource: () => ({ list: () => Promise.resolve([]) }),
}));

vi.mock("./past-minute-dialogs", () => ({
  PastMinuteFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="upload-open" /> : null,
  PastMinuteDetailDialog: ({ meetingId }: { meetingId: string | null }) =>
    meetingId ? <div data-testid="detail-open">{meetingId}</div> : null,
  ArchivistsDialog: () => null,
}));

function pastMinute(overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id: "past-1",
    workspaceId: "ws-1",
    title: "Mesyuarat Agung Tahunan 2015",
    meetingTypeId: null,
    bodyId: null,
    scheduledAt: "2015-06-20T00:00:00.000Z",
    location: null,
    confidential: false,
    status: "archived",
    adoptedAt: null,
    adoptedByMeetingId: null,
    referenceNo: "MAT/2015/01",
    chairperson: "Dato' Chair",
    summary: null,
    createdBy: "user-1",
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    meetingTypeLabel: "AGM",
    bodyName: "Board",
    matchedDocuments: [],
    documentCount: 2,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PastMinutes workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  state.items = [];
  state.canManage = false;
  state.isAdmin = false;
  try {
    localStorage.clear();
  } catch {
    // jsdom always has it; the component tolerates it missing.
  }
});

describe("PastMinutes", () => {
  it("shows the upload button only to someone who can manage the archive", () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: /upload past minutes/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the upload dialog for an archivist", async () => {
    state.canManage = true;
    renderPage();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /upload past minutes/i }));
    expect(screen.getByTestId("upload-open")).toBeInTheDocument();
  });

  it("opens in list view and remembers a switch to thumbnails", async () => {
    const user = userEvent.setup();
    state.items = [pastMinute()];
    const { unmount } = renderPage();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Board")).toBeInTheDocument();
    expect(within(table).getByText("MAT/2015/01")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-thumbnail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Thumbnail view" }));
    expect(screen.getByTestId("meeting-thumbnail")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    unmount();
    renderPage();
    expect(screen.getByTestId("meeting-thumbnail")).toBeInTheDocument();
  });

  it("shows each matching passage with the search term highlighted", async () => {
    const user = userEvent.setup();
    state.items = [
      pastMinute({
        matchedDocuments: [
          {
            id: "doc-1",
            filename: "minit-2015.docx",
            kind: "minutes",
            snippet: "…bajet tahunan diluluskan…",
            snippets: [
              "…bajet tahunan diluluskan…",
              "…semakan Bajet pada suku kedua…",
            ],
          },
        ],
      }),
    ];
    renderPage();
    await user.type(
      screen.getByRole("searchbox", { name: "Search Past Minutes" }),
      "bajet",
    );

    const marks = await screen.findAllByText(/^bajet$/i, { selector: "mark" });
    expect(marks).toHaveLength(2);
    expect(screen.getByText("minit-2015.docx")).toBeInTheDocument();
    expect(state.lastFilters).toMatchObject({ q: "bajet" });
  });

  it("opens a past minute from the list", async () => {
    const user = userEvent.setup();
    state.items = [pastMinute()];
    renderPage();
    await user.click(
      screen.getByRole("button", { name: "Mesyuarat Agung Tahunan 2015" }),
    );
    expect(screen.getByTestId("detail-open")).toHaveTextContent("past-1");
  });
});
