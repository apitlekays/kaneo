import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Letter } from "@/fetchers/correspondence/letters";
import { letterReference } from "@/lib/letter-reference";
import { LetterLinkPicker, type PendingLink } from "./letter-link-picker";

// Mock the letters query hook the picker reads candidates from (mirrors
// correspondence.test.tsx's mock of the same module).
const state = vi.hoisted(() => ({
  letters: [] as Letter[],
}));

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  useLetters: () => ({ data: state.letters, isLoading: false }),
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
    senderName: null,
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

describe("LetterLinkPicker", () => {
  it("filters the candidate list by what the user types", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({
        id: "letter-alpha",
        subject: "Alpha budget request",
        refNo: "REF-ALPHA",
      }),
      makeLetter({
        id: "letter-beta",
        subject: "Beta site visit report",
        refNo: "REF-BETA",
      }),
    ];

    render(
      <LetterLinkPicker workspaceId="ws-1" value={[]} onChange={vi.fn()} />,
    );

    expect(screen.getByText("Alpha budget request")).toBeVisible();
    expect(screen.getByText("Beta site visit report")).toBeVisible();

    await user.type(screen.getByPlaceholderText(/search letters/i), "budget");

    expect(screen.getByText("Alpha budget request")).toBeVisible();
    expect(
      screen.queryByText("Beta site visit report"),
    ).not.toBeInTheDocument();
  });

  it("adds a chosen letter to the value with the selected relation", async () => {
    const user = userEvent.setup();
    const letter = makeLetter({
      id: "letter-target",
      subject: "Follow-up on tender",
      direction: "out",
      refNo: "REF-OUT-1",
      externalRefNo: null,
    });
    state.letters = [letter];
    const onChange = vi.fn();

    render(
      <LetterLinkPicker workspaceId="ws-1" value={[]} onChange={onChange} />,
    );

    // Pick a relation other than the default before adding the letter.
    await user.click(screen.getByRole("combobox"));
    await user.click(
      await screen.findByRole("option", { name: /supersedes/i }),
    );

    await user.click(
      screen.getByRole("button", { name: /Follow-up on tender/ }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const expectedLabel = `${letterReference(letter)} — ${letter.subject}`;
    expect(onChange).toHaveBeenCalledWith([
      {
        toLetterId: "letter-target",
        relation: "supersedes",
        label: expectedLabel,
      } satisfies PendingLink,
    ]);
  });

  it("removes a link", async () => {
    const user = userEvent.setup();
    state.letters = [];
    const existing: PendingLink = {
      toLetterId: "letter-x",
      relation: "related",
      label: "REF-X — Some earlier subject",
    };
    const onChange = vi.fn();

    render(
      <LetterLinkPicker
        workspaceId="ws-1"
        value={[existing]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText(/Some earlier subject/)).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: `Remove link to ${existing.label}`,
      }),
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("never offers the letter being edited as its own link", async () => {
    // Linking a letter to itself would create a self-edge in the thread
    // graph, so excludeId must genuinely remove it from the candidates —
    // not just hide it behind a filter that a caller could bypass.
    state.letters = [
      makeLetter({ id: "letter-self", subject: "This letter itself" }),
      makeLetter({ id: "letter-other", subject: "A different letter" }),
    ];

    render(
      <LetterLinkPicker
        workspaceId="ws-1"
        value={[]}
        onChange={vi.fn()}
        excludeId="letter-self"
      />,
    );

    expect(screen.getByText("A different letter")).toBeVisible();
    expect(screen.queryByText("This letter itself")).not.toBeInTheDocument();
  });

  it("offers an already-linked letter under a different relation, but not under the one it's already linked as", async () => {
    // The backend has no unique constraint on (fromLetterId, toLetterId) —
    // the same pair can be linked twice under different relations — so the
    // picker must only suppress the exact (letter, relation) pair already
    // added, not the letter across every relation.
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-l2", subject: "Already linked as related" }),
    ];
    const existing: PendingLink = {
      toLetterId: "letter-l2",
      relation: "related",
      label: "REF-1 — Already linked as related",
    };

    render(
      <LetterLinkPicker
        workspaceId="ws-1"
        value={[existing]}
        onChange={vi.fn()}
      />,
    );

    // Default relation selection is "related" — same as the existing link,
    // so the letter must NOT be offered again under that relation.
    expect(
      screen.queryByText("Already linked as related"),
    ).not.toBeInTheDocument();

    // Switch the relation to "supersedes" — a different relation for the
    // same pair is allowed, so the letter must now be offered.
    await user.click(screen.getByRole("combobox"));
    await user.click(
      await screen.findByRole("option", { name: /supersedes/i }),
    );

    expect(screen.getByText("Already linked as related")).toBeVisible();
  });
});
