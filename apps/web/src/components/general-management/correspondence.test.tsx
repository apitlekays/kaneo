import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Letter } from "@/fetchers/correspondence/letters";
import { Correspondence } from "./correspondence";

// Mock the query hooks this component uses (read from the component's own
// imports rather than guessed paths).

const state = vi.hoisted(() => ({
  letters: [] as Letter[],
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useLetters: () => ({ data: state.letters, isLoading: false }),
  useAwaitingAcceptance: () => ({ data: [], isLoading: false }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock("@/hooks/queries/correspondence/use-config", () => ({
  useConfigList: () => ({ data: [] }),
}));

vi.mock("./letter-capture-dialog", () => ({
  LetterCaptureDialog: () => null,
}));

vi.mock("./letter-detail-dialog", () => ({
  LetterDetailDialog: () => null,
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
});
