import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LetterAttachment,
  LetterMinute,
} from "@/fetchers/correspondence/letters";
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

// The upload flow (presign → PUT → finalize) lives entirely inside
// uploadLetterAttachment; the thread only needs to know it was called with
// the right minuteUpdateId and that a rejection surfaces visibly. The real
// contract for the fetcher itself (field names, presign/finalize sequence)
// is exercised in the fetcher's own coverage, not here.
const mockUploadLetterAttachment = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/correspondence/letters", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/correspondence/letters")>();
  return {
    ...actual,
    uploadLetterAttachment: (
      ...args: Parameters<typeof actual.uploadLetterAttachment>
    ) => mockUploadLetterAttachment(...args),
  };
});

const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

// MinuteThread calls the real useQueryClient() to refresh the letter after
// a minute-update attachment upload, so every render needs a real
// QueryClient in context.
function renderThread(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

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
    acceptance: "accepted",
    rejectionReason: null,
    completedAt: null,
    completedBy: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updates: [],
    ...overrides,
  };
}

function makeAttachment(
  overrides: Partial<LetterAttachment> = {},
): LetterAttachment {
  return {
    id: "attachment-1",
    letterId: "letter-1",
    minuteUpdateId: null,
    objectKey: "key-1",
    filename: "report.pdf",
    mimeType: "application/pdf",
    size: 1024,
    sha256: null,
    kind: "original",
    createdAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.isPending = false;
  mockUploadLetterAttachment.mockReset();
  mockToastError.mockClear();
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

    renderThread(
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

    renderThread(
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

    renderThread(
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

    renderThread(
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

    renderThread(
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

  it("renders an update's own attachment but not one belonging to a different update", () => {
    const minute = makeMinute({
      updates: [
        {
          id: "update-1",
          minuteId: "minute-1",
          authorId: "user-2",
          body: "Progress report attached",
          createdAt: "2025-01-02T00:00:00.000Z",
        },
        {
          id: "update-2",
          minuteId: "minute-1",
          authorId: "user-1",
          body: "Second update",
          createdAt: "2025-01-03T00:00:00.000Z",
        },
      ],
    });
    const ownAttachment = makeAttachment({
      id: "attachment-own",
      minuteUpdateId: "update-1",
      filename: "own-report.pdf",
    });
    const otherAttachment = makeAttachment({
      id: "attachment-other",
      minuteUpdateId: "update-2",
      filename: "other-report.pdf",
    });

    renderThread(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
        attachments={[ownAttachment, otherAttachment]}
      />,
    );

    // Each update's row is `body` + its own attachments in one wrapper —
    // walk up from the body text to scope assertions to that row.
    const updateOneRow = screen.getByText("Progress report attached")
      .parentElement as HTMLElement;
    const updateTwoRow = screen.getByText("Second update")
      .parentElement as HTMLElement;

    // The attachment belonging to update-1 renders under it...
    expect(within(updateOneRow).getByText("own-report.pdf")).toBeVisible();
    // ...but the attachment belonging to update-2 does not appear under update-1.
    expect(
      within(updateOneRow).queryByText("other-report.pdf"),
    ).not.toBeInTheDocument();
    // And update-2's attachment renders under update-2, not update-1's.
    expect(within(updateTwoRow).getByText("other-report.pdf")).toBeVisible();
    expect(
      within(updateTwoRow).queryByText("own-report.pdf"),
    ).not.toBeInTheDocument();
  });

  it("posting an update with a file attached uploads it carrying that update's minuteUpdateId", async () => {
    const user = userEvent.setup();
    const minute = makeMinute({ updates: [] });
    const postedUpdate = {
      id: "update-99",
      minuteId: "minute-1",
      authorId: "user-2",
      body: "Progress report attached",
      createdAt: "2025-01-05T00:00:00.000Z",
    };
    // Stand in for the real mutation: invoke the caller's onSuccess with the
    // update the server would have returned, the same shape addMinuteUpdate
    // resolves to.
    state.mutate.mockImplementation((_vars, opts) => {
      opts.onSuccess(postedUpdate);
    });
    mockUploadLetterAttachment.mockResolvedValue({
      id: "attachment-new",
      letterId: "letter-1",
      minuteUpdateId: postedUpdate.id,
      objectKey: "key-new",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      sha256: null,
      kind: "original",
      createdAt: "2025-01-05T00:00:00.000Z",
    });

    const { container } = renderThread(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    const file = new File(["%PDF-1.4"], "report.pdf", {
      type: "application/pdf",
    });
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);
    expect(screen.getByText("report.pdf")).toBeVisible();

    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Progress report attached",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));

    expect(mockUploadLetterAttachment).toHaveBeenCalledWith(
      "ws-1",
      "letter-1",
      file,
      "original",
      "update-99",
    );
  });

  it("surfaces a failed attachment upload via toast instead of failing silently", async () => {
    const user = userEvent.setup();
    const minute = makeMinute({ updates: [] });
    const postedUpdate = {
      id: "update-100",
      minuteId: "minute-1",
      authorId: "user-2",
      body: "Report attached",
      createdAt: "2025-01-06T00:00:00.000Z",
    };
    state.mutate.mockImplementation((_vars, opts) => {
      opts.onSuccess(postedUpdate);
    });
    mockUploadLetterAttachment.mockRejectedValue(
      new Error("Upload to storage failed"),
    );

    const { container } = renderThread(
      <MinuteThread
        workspaceId="ws-1"
        letterId="letter-1"
        minute={minute}
        canPost
      />,
    );

    const file = new File(["%PDF-1.4"], "report.pdf", {
      type: "application/pdf",
    });
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Report attached",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/upload failed/i),
      );
    });
  });
});
