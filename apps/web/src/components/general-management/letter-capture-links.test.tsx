import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Letter } from "@/fetchers/correspondence/letters";
import { LetterCaptureDialog } from "./letter-capture-dialog";

// Mirrors correspondence.test.tsx / letter-link-picker.test.tsx: mock the
// query hooks this dialog (and the picker it renders) read from, plus the
// create mutation and the linkLetter fetcher the dialog calls directly.

const state = vi.hoisted(() => ({
  letters: [] as Letter[],
  organisations: [{ id: "org-1", label: "Org One" }] as {
    id: string;
    label: string;
  }[],
}));

const mockCreateMutate = vi.hoisted(() => vi.fn());
const mockLinkLetter = vi.hoisted(() => vi.fn());
const mockUploadLetterAttachment = vi.hoisted(() => vi.fn());
const mockUpdateLetter = vi.hoisted(() => vi.fn());
const mockSetLetterStatus = vi.hoisted(() => vi.fn());
const mockDisposeLetter = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/correspondence/use-letters", () => ({
  // The picker rendered inside the dialog reads its candidate list from
  // this same hook.
  useLetters: () => ({ data: state.letters, isLoading: false }),
  useLetterMutations: () => ({
    create: { mutate: mockCreateMutate, isPending: false },
  }),
}));

vi.mock("@/hooks/queries/correspondence/use-config", () => ({
  useConfigList: (resource: string) => ({
    data: resource === "organisations" ? state.organisations : [],
  }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock("@/fetchers/correspondence/letters", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/correspondence/letters")>();
  return {
    ...actual,
    linkLetter: mockLinkLetter,
    uploadLetterAttachment: mockUploadLetterAttachment,
    // Stand-ins for anything that could plausibly be misused as a rollback
    // of an already-created letter. None of these is a real "delete"
    // endpoint — the app has none — but test 2 asserts none of them fire.
    updateLetter: mockUpdateLetter,
    setLetterStatus: mockSetLetterStatus,
    disposeLetter: mockDisposeLetter,
  };
});

function makeLetter(overrides: Partial<Letter> = {}): Letter {
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
    status: "captured",
    dispositionStatus: null,
    legalHold: false,
    primaryAttachmentId: null,
    contentHash: null,
    currentAssigneeId: null,
    createdBy: null,
    declaredAt: null,
    closedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const newLetter = makeLetter({
  id: "new-1",
  direction: "out",
  // refNo stays null: capture never allocates a reference number (that
  // happens at registration/dispatch), so the failure banner must not
  // depend on one existing.
  refNo: null,
  subject: "New outgoing letter",
});

// Resolves createMutate's onSuccess callback with `newLetter`, matching how
// react-query invokes the per-call onSuccess after the mutationFn settles.
// Wrapped in act() because it drives React state updates (setLinking,
// setFailedLinks, ...) outside of a userEvent-triggered handler.
async function resolveCreateWith(letter: Letter) {
  const [, opts] = mockCreateMutate.mock.calls.at(-1) ?? [];
  await act(async () => {
    await opts?.onSuccess?.(letter);
  });
}

async function openDialogAndFillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
) {
  render(
    <LetterCaptureDialog
      workspaceId="ws-1"
      trigger={<button type="button">Open</button>}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open" }));
  await user.type(
    screen.getByPlaceholderText("Subject of the letter"),
    "Test subject",
  );
  // Owning organisation is required to enable Capture.
  const comboboxes = screen.getAllByRole("combobox");
  const orgCombobox = comboboxes.find((c) => c.textContent === "—");
  if (orgCombobox) {
    await user.click(orgCombobox);
    await user.click(await screen.findByRole("option", { name: "Org One" }));
  }
}

async function addLink(
  user: ReturnType<typeof userEvent.setup>,
  subjectText: string,
) {
  await user.click(
    screen.getByRole("button", { name: new RegExp(subjectText, "i") }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.letters = [];
});

describe("LetterCaptureDialog — link picker at registration", () => {
  it("posts each chosen link against the new letter's id after creation", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      makeLetter({ id: "letter-b", subject: "Beta letter", refNo: "REF-B" }),
    ];
    mockLinkLetter.mockResolvedValue({
      id: "link-1",
      fromLetterId: "new-1",
      toLetterId: "letter-a",
      relation: "related",
    });

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");
    await addLink(user, "Beta letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(mockCreateMutate).toHaveBeenCalledTimes(1);

    await resolveCreateWith(newLetter);

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(2));
    expect(mockLinkLetter).toHaveBeenCalledWith("ws-1", "new-1", {
      toLetterId: "letter-a",
      relation: "related",
    });
    expect(mockLinkLetter).toHaveBeenCalledWith("ws-1", "new-1", {
      toLetterId: "letter-b",
      relation: "related",
    });
  });

  it("keeps the letter and reports which links failed", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      makeLetter({ id: "letter-b", subject: "Beta letter", refNo: "REF-B" }),
      makeLetter({
        id: "letter-c",
        subject: "Gamma letter",
        refNo: "REF-C",
      }),
    ];
    // The second of three link posts (letter-b) rejects; the others resolve.
    mockLinkLetter.mockImplementation(
      (_ws: string, _id: string, body: { toLetterId: string }) =>
        body.toLetterId === "letter-b"
          ? Promise.reject(new Error("network error"))
          : Promise.resolve({
              id: `link-${body.toLetterId}`,
              fromLetterId: "new-1",
              toLetterId: body.toLetterId,
              relation: "related",
            }),
    );

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");
    await addLink(user, "Beta letter");
    await addLink(user, "Gamma letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await resolveCreateWith(newLetter);

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(3));

    // The dialog stays open — the "Register correspondence" heading and the
    // failure banner must both still be present.
    expect(screen.getByText("Register correspondence")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByText(
          'Letter "New outgoing letter" was captured. 1 of 3 links could not be saved.',
        ),
      ).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    // The created letter is never rolled back or deleted — there is no
    // delete endpoint in this app, so none of the mutating fetchers that
    // could plausibly stand in for one may be called either.
    expect(mockUpdateLetter).not.toHaveBeenCalled();
    expect(mockSetLetterStatus).not.toHaveBeenCalled();
    expect(mockDisposeLetter).not.toHaveBeenCalled();
  });

  it("retries only the failed links", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      makeLetter({ id: "letter-b", subject: "Beta letter", refNo: "REF-B" }),
      makeLetter({
        id: "letter-c",
        subject: "Gamma letter",
        refNo: "REF-C",
      }),
    ];
    // letter-b fails exactly once (on the initial attempt), then succeeds
    // on retry.
    let letterBFailedOnce = false;
    mockLinkLetter.mockImplementation(
      (_ws: string, _id: string, body: { toLetterId: string }) => {
        if (body.toLetterId === "letter-b" && !letterBFailedOnce) {
          letterBFailedOnce = true;
          return Promise.reject(new Error("network error"));
        }
        return Promise.resolve({
          id: `link-${body.toLetterId}`,
          fromLetterId: "new-1",
          toLetterId: body.toLetterId,
          relation: "related",
        });
      },
    );

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");
    await addLink(user, "Beta letter");
    await addLink(user, "Gamma letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await resolveCreateWith(newLetter);

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(3));
    mockLinkLetter.mockClear();

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));
    expect(mockLinkLetter).toHaveBeenCalledWith("ws-1", "new-1", {
      toLetterId: "letter-b",
      relation: "related",
    });
  });
});
