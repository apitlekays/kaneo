import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Letter,
  WatchlistAssignment,
} from "@/fetchers/correspondence/letters";
import { Correspondence } from "./correspondence";

// Mock the query hooks this component uses (read from the component's own
// imports rather than guessed paths).

const state = vi.hoisted(() => ({
  letters: [] as Letter[],
  awaiting: [] as WatchlistAssignment[],
  organisations: [] as { id: string; label: string; active: boolean }[],
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useLetters: () => ({ data: state.letters, isLoading: false }),
  useAwaitingAcceptance: () => ({ data: state.awaiting, isLoading: false }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock("@/hooks/queries/correspondence/use-config", () => ({
  // Mirrors the real fetcher's includeInactive semantics so the
  // "retired organisation" test actually exercises the caller passing
  // includeInactive: true, rather than always returning everything.
  useConfigList: (
    _resource: string,
    _workspaceId: string,
    includeInactive = false,
  ) => ({
    data: includeInactive
      ? state.organisations
      : state.organisations.filter((o) => o.active),
  }),
}));

vi.mock("./letter-capture-dialog", () => ({
  LetterCaptureDialog: () => null,
}));

vi.mock("./letter-detail-dialog", () => ({
  // Renders the open letterId (or nothing) so tests can observe whether a
  // click opened the letter detail dialog.
  LetterDetailDialog: ({ letterId }: { letterId: string | null }) =>
    letterId ? <div data-testid="detail-open">{letterId}</div> : null,
}));

vi.mock("./letter-thread-dialog", () => ({
  // Same idea, for the thread dialog.
  LetterThreadDialog: ({ letterId }: { letterId: string | null }) =>
    letterId ? <div data-testid="thread-open">{letterId}</div> : null,
}));

function makeLetter(overrides: Partial<Letter>): Letter {
  return {
    id: "letter-default",
    workspaceId: "ws-1",
    refNo: "REF-1",
    externalRefNo: null,
    urgency: "normal",
    organisationId: null,
    fileRef: null,
    jilid: null,
    direction: "in",
    type: "external",
    medium: "email",
    subject: "Default subject",
    senderName: "Someone",
    senderOrg: null,
    senderEmail: null,
    recipientName: null,
    recipientOrg: null,
    recipientEmail: null,
    letterDate: null,
    receivedAt: null,
    dispatchedAt: null,
    categoryId: null,
    filePlanNodeId: null,
    securityLabelId: null,
    numberSchemeId: null,
    retentionClassId: null,
    status: "registered",
    dispositionStatus: null,
    legalHold: false,
    primaryAttachmentId: null,
    contentHash: null,
    currentAssigneeId: null,
    createdBy: null,
    declaredAt: null,
    closedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(cleanup);

describe("correspondence register", () => {
  it("groups letters under year headings, newest year first", async () => {
    // Two letters in 2025, one in 2026.
    state.letters = [
      makeLetter({
        id: "letter-2025-a",
        refNo: "REF-2025-A",
        subject: "March letter",
        receivedAt: "2025-03-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-2025-b",
        refNo: "REF-2025-B",
        subject: "June letter",
        receivedAt: "2025-06-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-2026-a",
        refNo: "REF-2026-A",
        subject: "January letter",
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    const headings = screen.getAllByText(/^(2025|2026)$/);
    expect(headings.map((h) => h.textContent)).toEqual(["2026", "2025"]);
  });

  it("flips both heading order and row order when Date is clicked", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({
        id: "letter-2025-a",
        refNo: "REF-2025-A",
        subject: "March letter",
        receivedAt: "2025-03-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-2025-b",
        refNo: "REF-2025-B",
        subject: "June letter",
        receivedAt: "2025-06-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-2026-a",
        refNo: "REF-2026-A",
        subject: "January letter",
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    // Descending by default: 2026, 2025 — and within 2025, June before March.
    expect(
      screen.getAllByText(/^(2025|2026)$/).map((h) => h.textContent),
    ).toEqual(["2026", "2025"]);
    const rowsBefore = screen.getAllByRole("row").map((r) => r.textContent);
    const juneIndexBefore = rowsBefore.findIndex((t) =>
      t?.includes("June letter"),
    );
    const marchIndexBefore = rowsBefore.findIndex((t) =>
      t?.includes("March letter"),
    );
    expect(juneIndexBefore).toBeLessThan(marchIndexBefore);

    await user.click(screen.getByRole("button", { name: /Date/ }));

    expect(
      screen.getAllByText(/^(2025|2026)$/).map((h) => h.textContent),
    ).toEqual(["2025", "2026"]);
    const rowsAfter = screen.getAllByRole("row").map((r) => r.textContent);
    const juneIndexAfter = rowsAfter.findIndex((t) =>
      t?.includes("June letter"),
    );
    const marchIndexAfter = rowsAfter.findIndex((t) =>
      t?.includes("March letter"),
    );
    expect(marchIndexAfter).toBeLessThan(juneIndexAfter);
  });

  it("shows the ERN for an incoming letter and labels the column ERN", async () => {
    state.letters = [
      makeLetter({
        id: "letter-in-1",
        direction: "in",
        refNo: "REF-IN-1",
        externalRefNo: "ERN-999",
        subject: "Incoming with ERN",
        receivedAt: "2025-05-01T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    expect(screen.getByText("ERN")).toBeVisible();
    expect(screen.getByText("ERN-999")).toBeVisible();
  });

  it("shows an Urgent badge only on the urgent letter", async () => {
    state.letters = [
      makeLetter({
        id: "letter-urgent",
        urgency: "urgent",
        subject: "Urgent one",
        receivedAt: "2025-05-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-normal",
        urgency: "normal",
        subject: "Normal one",
        receivedAt: "2025-05-02T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    expect(screen.getAllByText("Urgent")).toHaveLength(1);
  });

  it("labels the pending-registration tile's reference column neutrally, not direction-aware", async () => {
    // The watchlist mixes incoming and outgoing letters (its query has no
    // direction filter), so its header must not borrow the page's "in"/"out"
    // toggle — that would mislabel whichever direction it doesn't match.
    // Page direction defaults to "in", where a direction-aware header would
    // read "ERN" — assert it does not.
    const user = userEvent.setup();
    state.awaiting = [
      {
        id: "assign-1",
        letterId: "letter-1",
        refNo: "REF-1",
        externalRefNo: "ERN-1",
        direction: "in",
        subject: "Awaiting decision",
        action: "inspect",
        note: null,
        createdAt: "2025-05-01T00:00:00.000Z",
        toUserId: null,
        status: "pending",
        decidedAt: null,
        currentAssigneeId: null,
      },
    ];

    render(<Correspondence workspaceId="ws-1" />);
    await user.click(screen.getByRole("button", { name: /Needs attention/ }));

    expect(screen.getByText("Reference")).toBeVisible();
    expect(screen.queryByText("ERN")).not.toBeInTheDocument();
  });

  it("shows a retired organisation's label on its historical letter, not em-dash", async () => {
    // The org config list includes inactive rows here (useConfigList is
    // called with includeInactive: true from the register), so a letter
    // owned by a deactivated organisation still resolves its name instead
    // of falling through to "—".
    state.organisations = [
      { id: "org-retired", label: "Retired Org Sdn Bhd", active: false },
    ];
    state.letters = [
      makeLetter({
        id: "letter-retired-org",
        subject: "Letter for a retired organisation",
        organisationId: "org-retired",
        receivedAt: "2025-05-01T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    expect(screen.getByText("Retired Org Sdn Bhd")).toBeVisible();
  });

  it("shows the thread icon only for a letter with links, not for one without", async () => {
    state.letters = [
      makeLetter({
        id: "letter-linked",
        subject: "Has a thread",
        linkCount: 2,
        receivedAt: "2025-05-01T00:00:00.000Z",
      }),
      makeLetter({
        id: "letter-unlinked",
        subject: "No thread",
        linkCount: 0,
        receivedAt: "2025-05-02T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    expect(
      screen.getAllByRole("button", { name: /view letter thread/i }),
    ).toHaveLength(1);
  });

  it("opens the thread dialog from the icon without opening the letter detail", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({
        id: "letter-linked",
        subject: "Has a thread",
        linkCount: 1,
        receivedAt: "2025-05-01T00:00:00.000Z",
      }),
    ];

    render(<Correspondence workspaceId="ws-1" />);

    // The row itself has an onClick that opens the letter detail — clicking
    // the icon inside it must not also trigger that.
    await user.click(
      screen.getByRole("button", { name: /view letter thread/i }),
    );

    expect(screen.getByTestId("thread-open")).toHaveTextContent(
      "letter-linked",
    );
    expect(screen.queryByTestId("detail-open")).not.toBeInTheDocument();
  });
});
