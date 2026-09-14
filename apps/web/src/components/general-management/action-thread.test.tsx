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
import type { MeetingAction, MeetingActionUpdate } from "@/fetchers/meeting";
import { ActionThread } from "./action-thread";

// Mock the mutation hook — this suite is about the thread's rendering and
// composer behaviour, not the network/invalidation contract (that lives in
// use-meeting-mutations.ts's own coverage).
const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/hooks/queries/meeting/use-meeting-mutations", () => ({
  useAddActionUpdate: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
  }),
}));

// The thread fetches its own data (there is no embedded `updates` array on
// the action, unlike Letter Minutes) — mock the fetcher, not a query hook,
// so the real useQuery loading/error/success lifecycle actually runs.
const mockListActionUpdates = vi.hoisted(() => vi.fn());
const mockUploadMeetingDocument = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/meeting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/fetchers/meeting")>();
  return {
    ...actual,
    listActionUpdates: (...args: Parameters<typeof actual.listActionUpdates>) =>
      mockListActionUpdates(...args),
    uploadMeetingDocument: (
      ...args: Parameters<typeof actual.uploadMeetingDocument>
    ) => mockUploadMeetingDocument(...args),
  };
});

const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

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

function renderThread(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function makeAction(overrides: Partial<MeetingAction> = {}): MeetingAction {
  return {
    id: "action-1",
    meetingId: "meeting-1",
    minuteItemId: null,
    assigneeId: "user-2",
    fromUserId: null,
    description: "Follow up with vendor",
    dueAt: null,
    acceptance: "accepted",
    rejectionReason: null,
    status: "open",
    completedAt: null,
    completedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerText: string,
  optionName: string,
) {
  const trigger = screen.getByText(triggerText).closest('[role="combobox"]');
  if (!trigger)
    throw new Error(`No combobox trigger found for "${triggerText}"`);
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.isPending = false;
  mockListActionUpdates.mockReset();
  mockUploadMeetingDocument.mockReset();
  mockToastError.mockClear();
});

describe("ActionThread", () => {
  it("shows a loading state while the thread is being fetched", () => {
    mockListActionUpdates.mockReturnValue(new Promise(() => {}));

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/no updates yet/i)).not.toBeInTheDocument();
  });

  it("shows a distinguishable error state when the thread fails to load — not the empty state", async () => {
    mockListActionUpdates.mockRejectedValue(new Error("Not found"));

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no updates yet/i)).not.toBeInTheDocument();
  });

  it("shows a distinguishable empty state when there are no updates — not an error", async () => {
    mockListActionUpdates.mockResolvedValue([]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders updates oldest-first, each with author, timestamp, body and the status it set", async () => {
    const updates: MeetingActionUpdate[] = [
      {
        id: "update-1",
        actionId: "action-1",
        authorId: "user-2",
        body: "Started drafting",
        statusAfter: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "update-2",
        actionId: "action-1",
        authorId: "user-1",
        body: "Marked done",
        statusAfter: "done",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    mockListActionUpdates.mockResolvedValue(updates);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );

    const bodies = await screen.findAllByText(/Started drafting|Marked done/);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveTextContent("Started drafting");
    expect(bodies[1]).toHaveTextContent("Marked done");
    expect(screen.getByText("Bob Assignee")).toBeVisible();
    expect(screen.getByText("Alice Officer")).toBeVisible();
    // The status the second update set is shown alongside it.
    expect(screen.getByText(/set status: done/i)).toBeVisible();
  });

  it("shows no edit or delete affordance on an existing update — the thread is append-only", async () => {
    mockListActionUpdates.mockResolvedValue([
      {
        id: "update-1",
        actionId: "action-1",
        authorId: "user-2",
        body: "Started drafting",
        statusAfter: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] satisfies MeetingActionUpdate[]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );

    await screen.findByText("Started drafting");
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render a composer when canPost is false", async () => {
    mockListActionUpdates.mockResolvedValue([]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByPlaceholderText(/post an update/i),
    ).not.toBeInTheDocument();
  });

  it("disables the submit control while the body is empty or whitespace-only", async () => {
    const user = userEvent.setup();
    mockListActionUpdates.mockResolvedValue([]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
    );

    const submit = screen.getByRole("button", { name: /post update/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/post an update/i), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/post an update/i), "ok");
    expect(submit).not.toBeDisabled();
  });

  it("posts a body with no status change by default", async () => {
    const user = userEvent.setup();
    mockListActionUpdates.mockResolvedValue([]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
    );

    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Vendor confirmed",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenCalledWith(
      {
        actionId: "action-1",
        body: "Vendor confirmed",
        statusAfter: undefined,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("includes the chosen status when one is picked on the composer", async () => {
    const user = userEvent.setup();
    mockListActionUpdates.mockResolvedValue([]);

    renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
    );

    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Wrapping up",
    );
    await pickOption(user, "No status change", "Mark done");
    await user.click(screen.getByRole("button", { name: /post update/i }));

    expect(state.mutate).toHaveBeenCalledWith(
      { actionId: "action-1", body: "Wrapping up", statusAfter: "done" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("rejects a non-PDF file picked in the attachment picker", async () => {
    // `applyAccept: false` — user-event v14 otherwise silently filters the
    // upload against the input's own `accept` attribute before it ever
    // reaches the app's `onChange`, which would make this never exercise
    // the component's own guard at all.
    const user = userEvent.setup({ applyAccept: false });
    mockListActionUpdates.mockResolvedValue([]);

    const { container } = renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
    );

    const file = new File(["not a pdf"], "notes.txt", {
      type: "text/plain",
    });
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/pdf/i));
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("uploads an attached PDF after posting, tagged with the new update's id", async () => {
    const user = userEvent.setup();
    mockListActionUpdates.mockResolvedValue([]);
    const postedUpdate: MeetingActionUpdate = {
      id: "update-99",
      actionId: "action-1",
      authorId: "user-2",
      body: "Progress report attached",
      statusAfter: null,
      createdAt: "2026-01-05T00:00:00.000Z",
    };
    state.mutate.mockImplementation((_vars, opts) => {
      opts.onSuccess(postedUpdate);
    });
    mockUploadMeetingDocument.mockResolvedValue({
      id: "doc-1",
      meetingId: "meeting-1",
      actionUpdateId: postedUpdate.id,
      workspaceId: "ws-1",
      objectKey: "key-new",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      sha256: null,
      kind: "original",
      createdBy: "user-2",
      createdAt: "2026-01-05T00:00:00.000Z",
    });

    const { container } = renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
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

    await waitFor(() => {
      expect(mockUploadMeetingDocument).toHaveBeenCalledWith(
        "ws-1",
        "meeting-1",
        file,
        "update-99",
      );
    });
  });

  it("surfaces a failed attachment upload via toast instead of failing silently", async () => {
    const user = userEvent.setup();
    mockListActionUpdates.mockResolvedValue([]);
    const postedUpdate: MeetingActionUpdate = {
      id: "update-100",
      actionId: "action-1",
      authorId: "user-2",
      body: "Report attached",
      statusAfter: null,
      createdAt: "2026-01-06T00:00:00.000Z",
    };
    state.mutate.mockImplementation((_vars, opts) => {
      opts.onSuccess(postedUpdate);
    });
    mockUploadMeetingDocument.mockRejectedValue(
      new Error("Upload to storage failed"),
    );

    const { container } = renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
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

  it("scopes an update's attachment display to that update, not another one", async () => {
    const user = userEvent.setup();
    const firstUpdate: MeetingActionUpdate = {
      id: "update-201",
      actionId: "action-1",
      authorId: "user-2",
      body: "First report",
      statusAfter: null,
      createdAt: "2026-01-07T00:00:00.000Z",
    };
    const secondUpdate: MeetingActionUpdate = {
      id: "update-202",
      actionId: "action-1",
      authorId: "user-2",
      body: "Second report",
      statusAfter: null,
      createdAt: "2026-01-08T00:00:00.000Z",
    };
    // Posting invalidates the thread's own query, which in real usage
    // refetches from a server that now includes the just-created row — model
    // that here instead of a fetcher that always returns the same list,
    // otherwise this test could never observe a posted update at all.
    let serverRows: MeetingActionUpdate[] = [];
    mockListActionUpdates.mockImplementation(async () => [...serverRows]);
    state.mutate
      .mockImplementationOnce((_vars, opts) => {
        serverRows = [...serverRows, firstUpdate];
        opts.onSuccess(firstUpdate);
      })
      .mockImplementationOnce((_vars, opts) => {
        serverRows = [...serverRows, secondUpdate];
        opts.onSuccess(secondUpdate);
      });
    mockUploadMeetingDocument
      .mockResolvedValueOnce({
        id: "doc-first",
        meetingId: "meeting-1",
        actionUpdateId: firstUpdate.id,
        workspaceId: "ws-1",
        objectKey: "key-first",
        filename: "first.pdf",
        mimeType: "application/pdf",
        size: 100,
        sha256: null,
        kind: "original",
        createdBy: "user-2",
        createdAt: "2026-01-07T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "doc-second",
        meetingId: "meeting-1",
        actionUpdateId: secondUpdate.id,
        workspaceId: "ws-1",
        objectKey: "key-second",
        filename: "second.pdf",
        mimeType: "application/pdf",
        size: 100,
        sha256: null,
        kind: "original",
        createdBy: "user-2",
        createdAt: "2026-01-08T00:00:00.000Z",
      });

    const { container } = renderThread(
      <ActionThread
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        canPost
      />,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/post an update/i)).toBeVisible(),
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    await user.upload(
      fileInput,
      new File(["%PDF-1.4"], "first.pdf", { type: "application/pdf" }),
    );
    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "First report",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));
    await waitFor(() => expect(screen.getByText("first.pdf")).toBeVisible());

    await user.upload(
      fileInput,
      new File(["%PDF-1.4"], "second.pdf", { type: "application/pdf" }),
    );
    await user.type(
      screen.getByPlaceholderText(/post an update/i),
      "Second report",
    );
    await user.click(screen.getByRole("button", { name: /post update/i }));
    await waitFor(() => expect(screen.getByText("second.pdf")).toBeVisible());

    const firstRow = screen.getByText("First report").closest("li");
    const secondRow = screen.getByText("Second report").closest("li");
    if (!firstRow || !secondRow) throw new Error("Row not found");

    expect(within(firstRow).getByText("first.pdf")).toBeVisible();
    expect(within(firstRow).queryByText("second.pdf")).not.toBeInTheDocument();
    expect(within(secondRow).getByText("second.pdf")).toBeVisible();
    expect(within(secondRow).queryByText("first.pdf")).not.toBeInTheDocument();
  });
});
