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
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/toast", () => ({
  toast: { error: mockToastError },
}));

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

  it("clears a stale failure banner when dismissed with Escape and reopened", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
    ];
    mockLinkLetter.mockRejectedValue(new Error("network error"));

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await resolveCreateWith(newLetter);

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Letter "New outgoing letter" was captured. 1 of 1 links could not be saved.',
        ),
      ).toBeVisible(),
    );

    // Dismiss the way Escape does — bypassing the Close button entirely —
    // and make sure that still leaves a clean form behind.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByText("Register correspondence"),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
  });

  it("discards a retry result that settles after the dialog was dismissed", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
    ];

    // The initial post (from Capture) fails, landing us in the
    // failure-banner state with a Retry button available.
    mockLinkLetter.mockRejectedValueOnce(new Error("network error"));

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await resolveCreateWith(newLetter);

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Letter "New outgoing letter" was captured. 1 of 1 links could not be saved.',
        ),
      ).toBeVisible(),
    );

    // The retry's post is held open until we settle it ourselves, so we can
    // dismiss the dialog while it's still in flight.
    let rejectRetry: (err: Error) => void = () => {};
    mockLinkLetter.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(2));

    // Dismiss via Escape — not Close, which is disabled during a retry —
    // while the retry promise is still unsettled.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByText("Register correspondence"),
      ).not.toBeInTheDocument(),
    );

    // Now let the retry settle (still failing). Its state writes must be
    // discarded rather than repopulating the failure banner post-dismissal.
    await act(async () => {
      rejectRetry(new Error("network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
  });

  it("discards an initial link-post result that settles after the dialog was dismissed", async () => {
    const user = userEvent.setup();
    state.letters = [
      makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
    ];

    // The initial post is held open until we settle it ourselves, so we can
    // dismiss the dialog before it resolves. failedLinks is still [] at
    // this point (there has been no failure yet), so handleOpenChange's
    // reset-on-close guard does not fire on this dismissal — this is
    // exactly the gap the fix has to cover on its own.
    let rejectInitialPost: (err: Error) => void = () => {};
    mockLinkLetter.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectInitialPost = reject;
        }),
    );

    await openDialogAndFillRequiredFields(user);
    await addLink(user, "Alpha letter");

    await user.click(screen.getByRole("button", { name: "Capture" }));

    // Fire onSuccess without awaiting it to completion — unlike
    // resolveCreateWith, which awaits the whole callback, this scenario
    // holds the link post open deliberately, so awaiting the full callback
    // here would deadlock. postLinks() calls linkLetter for every pending
    // link synchronously (via Array#map) before its own first await, so
    // this still reaches the held mock before the act() call returns.
    const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
    act(() => {
      void createOpts?.onSuccess?.(newLetter);
    });

    await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

    // Dismiss via Escape while the initial post is still in flight.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByText("Register correspondence"),
      ).not.toBeInTheDocument(),
    );

    // Now let the post settle as a failure. Its state writes must be
    // discarded rather than surfacing a failure banner post-dismissal.
    await act(async () => {
      rejectInitialPost(new Error("network error"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
  });

  // C1: a submission-generation counter replaces the old "is the dialog
  // open right now" boolean, which cannot distinguish "still this
  // submission" from "a later, unrelated one". These three tests pin the
  // three ways that boolean broke.
  describe("C1 — generation guard distinguishes submissions, not just open/closed", () => {
    it("(a) surfaces a failed initial link post via toast instead of letting it vanish unseen when dismissed first", async () => {
      const user = userEvent.setup();
      state.letters = [
        makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      ];

      let rejectInitialPost: (err: Error) => void = () => {};
      mockLinkLetter.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectInitialPost = reject;
          }),
      );

      await openDialogAndFillRequiredFields(user);
      await addLink(user, "Alpha letter");
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

      // Dismiss while the initial post is still in flight. failedLinks is
      // still [] at this point, so handleOpenChange's own reset-on-close
      // toast never fires — there is nothing yet for it to report.
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );

      // Now let it fail. With only a boolean guard this result is simply
      // discarded — no banner (the dialog is closed), no toast, no record
      // of which link was meant. That silent loss is what this asserts
      // against.
      await act(async () => {
        rejectInitialPost(new Error("network error"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockToastError).toHaveBeenCalledWith(
        "1 link could not be saved, but the letter was captured and is safe.",
      );
    });

    it("(b) resets the form on a dismissal that lands after the initial link post SUCCEEDS, so reopening doesn't show a stale filled form", async () => {
      const user = userEvent.setup();
      state.letters = [
        makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      ];

      let resolveInitialPost: (value: unknown) => void = () => {};
      mockLinkLetter.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialPost = resolve;
          }),
      );

      await openDialogAndFillRequiredFields(user);
      await addLink(user, "Alpha letter");
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );

      // Now let the link post succeed. A boolean "is it open" guard returns
      // early here too (dialog is closed) — which, before the fix, skipped
      // the unconditional reset() that runs on a clean success path,
      // leaving the fully populated form (including the letter that was
      // just captured) behind for the next open.
      await act(async () => {
        resolveInitialPost({
          id: "link-1",
          fromLetterId: "new-1",
          toLetterId: "letter-a",
          relation: "related",
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      await user.click(screen.getByRole("button", { name: "Open" }));

      expect(screen.getByPlaceholderText("Subject of the letter")).toHaveValue(
        "",
      );
    });

    it("(c) never force-closes the dialog or paints a stale banner over a fresh entry started after a dismiss + reopen", async () => {
      const user = userEvent.setup();
      state.letters = [
        makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      ];

      let rejectFirstPost: (err: Error) => void = () => {};
      mockLinkLetter.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirstPost = reject;
          }),
      );

      await openDialogAndFillRequiredFields(user);
      await addLink(user, "Alpha letter");
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

      // Dismiss while the first submission's link post is still in flight...
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );

      // ...then reopen and start a second, unrelated entry. A boolean "is it
      // open" guard is true again here, indistinguishable from the first
      // submission still being the live one.
      await user.click(screen.getByRole("button", { name: "Open" }));
      const subjectInput = screen.getByPlaceholderText("Subject of the letter");
      await user.clear(subjectInput);
      await user.type(subjectInput, "Second letter, unrelated to the first");
      expect(screen.getByText("Register correspondence")).toBeVisible();

      // Now the FIRST submission's link post resolves as a failure. Before
      // the fix this would paint a banner naming the first ("New outgoing
      // letter") submission over the second form — or, on a success, run
      // reset(); setOpen(false) and force the dialog closed out from under
      // whatever the user is doing now.
      await act(async () => {
        rejectFirstPost(new Error("network error"));
        await Promise.resolve();
        await Promise.resolve();
      });

      // Never force-closed by a stale result.
      expect(screen.getByText("Register correspondence")).toBeVisible();
      // Never a banner naming the first, already-dismissed submission.
      expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/New outgoing letter/)).not.toBeInTheDocument();
    });

    it("(d) leaves a reopened, in-progress entry untouched when a stale result resolves while the dialog is open", async () => {
      // The distinction that matters for reset() is not "same submission or
      // not" but "stale AND the dialog is currently closed". A stale result
      // landing while the dialog is open (the user reopened it and started
      // typing something new) must not clear that typed entry out from
      // under them — that is the exact harm (c) above is about.
      const user = userEvent.setup();
      state.letters = [
        makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      ];

      let rejectFirstPost: (err: Error) => void = () => {};
      mockLinkLetter.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirstPost = reject;
          }),
      );

      await openDialogAndFillRequiredFields(user);
      await addLink(user, "Alpha letter");
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

      // Dismiss while the first submission's link post is still in flight...
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );

      // ...reopen, and type a subject for a genuinely new entry.
      await user.click(screen.getByRole("button", { name: "Open" }));
      const subjectInput = screen.getByPlaceholderText("Subject of the letter");
      await user.clear(subjectInput);
      await user.type(subjectInput, "A brand new entry the user is typing");

      // Now let the first submission's link post settle (as a failure —
      // the toast should still fire; only the reset must be suppressed).
      await act(async () => {
        rejectFirstPost(new Error("network error"));
        await Promise.resolve();
        await Promise.resolve();
      });

      // The dialog is open, so the reset must NOT have run: the user's
      // typed subject is exactly what they left it as.
      expect(screen.getByPlaceholderText("Subject of the letter")).toHaveValue(
        "A brand new entry the user is typing",
      );
      // No banner over it either.
      expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
      // The failure must still not vanish unseen, even though it wasn't
      // safe to reset for.
      expect(mockToastError).toHaveBeenCalledWith(
        "1 link could not be saved, but the letter was captured and is safe.",
      );
    });

    it("(R1) the Cancel button bumps the generation like every other dismissal route, so a stale in-flight failure surfaces via toast instead of writing an invisible banner behind a closed dialog", async () => {
      // Before this fix, Cancel called setOpen(false) directly instead of
      // going through handleOpenChange, so gen was never bumped. Unlike
      // every other dismissal route (Escape, backdrop, header X, Close),
      // Cancel is also never disabled — it's clickable at any point during
      // Capture, including while the initial link post is still in flight
      // for the CURRENT generation. Clicking it there used to leave
      // gen.current === mine, so the async handler took the "current"
      // branch and wrote banner state against a dialog the user had just
      // closed: no banner (closed), no toast (only the stale branch raises
      // one) — the failure vanished. This is failure mode C1(a), reachable
      // through a route the earlier C1 tests (which all use Escape) never
      // exercised.
      const user = userEvent.setup();
      state.letters = [
        makeLetter({ id: "letter-a", subject: "Alpha letter", refNo: "REF-A" }),
      ];

      let rejectInitialPost: (err: Error) => void = () => {};
      mockLinkLetter.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectInitialPost = reject;
          }),
      );

      await openDialogAndFillRequiredFields(user);
      await addLink(user, "Alpha letter");
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() => expect(mockLinkLetter).toHaveBeenCalledTimes(1));

      // Click Cancel — the button, not Escape — while the initial link
      // post is still in flight for the current generation.
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );

      // Now let it fail.
      await act(async () => {
        rejectInitialPost(new Error("network error"));
        await Promise.resolve();
        await Promise.resolve();
      });

      // The failure must surface via toast, not vanish.
      expect(mockToastError).toHaveBeenCalledWith(
        "1 link could not be saved, but the letter was captured and is safe.",
      );

      // And reopening must show a clean form — not the previous letter's
      // populated fields plus a stale failure banner (which is exactly
      // what the comment above handleOpenChange claims never happens).
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByPlaceholderText("Subject of the letter")).toHaveValue(
        "",
      );
      expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
    });

    it("(R2) a dismiss + reopen DURING the create request (not the link post) is still caught, because `mine` is captured before the mutation is even sent", async () => {
      // mine used to be captured as the first line of onSuccess, which only
      // runs once the create request has already resolved. A dismiss +
      // reopen that happens WHILE the create is still pending was
      // therefore invisible to it: onSuccess would read gen.current only
      // after the reopen had already bumped it, so its own (really stale)
      // submission would look current, fall through to the no-pending-
      // links path, and wipe the freshly reopened entry.
      const user = userEvent.setup();

      await openDialogAndFillRequiredFields(user);
      await user.click(screen.getByRole("button", { name: "Capture" }));
      expect(mockCreateMutate).toHaveBeenCalledTimes(1);

      // The create request is now "pending" — onSuccess has not been
      // invoked yet. Dismiss and reopen while it's still outstanding.
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "Open" }));

      // Start a genuinely new, unrelated entry in the reopened dialog.
      const subjectInput = screen.getByPlaceholderText("Subject of the letter");
      await user.clear(subjectInput);
      await user.type(subjectInput, "A second, unrelated entry");

      // NOW the first create request resolves — late, for a generation
      // that's no longer current. It has no links, so with the bug this
      // falls straight through to reset(); setOpen(false).
      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      await act(async () => {
        await createOpts?.onSuccess?.(newLetter);
      });

      // The dialog must still be open, with the user's second entry intact
      // — not force-closed, not reset back to empty.
      expect(screen.getByText("Register correspondence")).toBeVisible();
      expect(screen.getByPlaceholderText("Subject of the letter")).toHaveValue(
        "A second, unrelated entry",
      );
    });

    it("(R3) a stale generation is still caught for a letter with an attachment and NO links, where the only await is the upload", async () => {
      // The staleness check used to live inside `if (pendingLinks.length >
      // 0)`, so a letter captured with just a file and no links skipped it
      // entirely — the attachment upload above awaits just as long as a
      // link post does, and a dismiss + reopen during it fell straight
      // through to the unconditional reset()/setOpen(false), clearing the
      // reopened entry and force-closing the dialog regardless of gen.
      const user = userEvent.setup();

      let resolveUpload: (value: unknown) => void = () => {};
      mockUploadLetterAttachment.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve;
          }),
      );

      await openDialogAndFillRequiredFields(user);

      // Attach a file. Empty MIME type + a .pdf name passes isPdfUpload
      // (some systems report no MIME type at all) while taking
      // compressPdfIfScanned's immediate "not-pdf" shortcut (it only
      // special-cases `file.type === "application/pdf"`), so no real PDF
      // engine work is triggered here — only the upload fetcher, which is
      // held open above.
      const file = new File(["scan bytes"], "scan.pdf", { type: "" });
      const fileInput = screen.getByLabelText(/choose a file/i);
      await user.upload(fileInput, file);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Capture" }),
        ).not.toBeDisabled(),
      );

      // No links attached — this is the fall-through path R3 is about.
      await user.click(screen.getByRole("button", { name: "Capture" }));

      const [, createOpts] = mockCreateMutate.mock.calls.at(-1) ?? [];
      act(() => {
        void createOpts?.onSuccess?.(newLetter);
      });

      await waitFor(() =>
        expect(mockUploadLetterAttachment).toHaveBeenCalledTimes(1),
      );

      // Dismiss and reopen while the upload is still in flight, then start
      // a fresh, unrelated entry.
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByText("Register correspondence"),
        ).not.toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "Open" }));
      const subjectInput = screen.getByPlaceholderText("Subject of the letter");
      await user.clear(subjectInput);
      await user.type(subjectInput, "A fresh entry started during the upload");

      // Now let the (stale) upload resolve.
      await act(async () => {
        resolveUpload({});
        await Promise.resolve();
        await Promise.resolve();
      });

      // Never force-closed, never reset out from under the fresh entry.
      expect(screen.getByText("Register correspondence")).toBeVisible();
      expect(screen.getByPlaceholderText("Subject of the letter")).toHaveValue(
        "A fresh entry started during the upload",
      );
    });
  });
});
