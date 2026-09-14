import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MeetingAction,
  MeetingActionMemoContext,
} from "@/fetchers/meeting";
import { ActionConfigureDialog } from "./action-configure-dialog";

// The editor itself (TipTap) is comment-editor.tsx's own concern — this
// suite is about what this dialog does with the Markdown value it hands
// the editor and gets back, not about editing Markdown. Stubbed as a plain
// textarea so `value`/`onChange` can be driven directly.
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      aria-label="Memorandum body"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

const state = vi.hoisted(() => ({
  data: null as MeetingActionMemoContext | null,
  isLoading: false,
  isError: false,
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/hooks/queries/meeting/use-action-memo", () => ({
  useActionMemo: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useSendActionMemo: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
  }),
}));

function makeAction(overrides: Partial<MeetingAction> = {}): MeetingAction {
  return {
    id: "action-1",
    meetingId: "meeting-1",
    minuteItemId: "item-1",
    assigneeId: null,
    fromUserId: null,
    description: "Circulate the approved budget",
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

function makeMemoContext(
  overrides: Partial<MeetingActionMemoContext> = {},
): MeetingActionMemoContext {
  return {
    defaultTemplate:
      "Dengan hormatnya, sekretariat menjemput {{recipient_name}} untuk memberikan maklumbalas.",
    values: {
      meeting_name: "Q3 Committee Meeting",
      meeting_date: "2026-03-01",
      numbering: "3.2",
      topic: "Approve the annual budget",
      status: "Dalam tindakan",
      recipient_name: "",
      notes: "",
    },
    lastSend: null,
    ...overrides,
  };
}

afterEach(() => {
  state.data = null;
  state.isLoading = false;
  state.isError = false;
  state.isPending = false;
  state.mutate.mockClear();
  mockToastSuccess.mockClear();
  mockToastError.mockClear();
});

describe("ActionConfigureDialog", () => {
  it("renders the default template in the editor and lists the available shortcodes", () => {
    state.data = makeMemoContext();

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Memorandum body")).toHaveValue(
      state.data.defaultTemplate,
    );
    expect(screen.getByText("{{meeting_name}}")).toBeInTheDocument();
    expect(screen.getByText("{{action_table}}")).toBeInTheDocument();
  });

  it("lists exactly the eight documented shortcode tokens — kept in step with the API's MEMO_SHORTCODES", () => {
    state.data = makeMemoContext();

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    const expectedTokens = [
      "meeting_name",
      "meeting_date",
      "numbering",
      "topic",
      "status",
      "recipient_name",
      "action_table",
      "notes",
    ];

    for (const token of expectedTokens) {
      expect(screen.getByText(`{{${token}}}`)).toBeInTheDocument();
    }

    const shortcodeList = screen.getByTestId("memo-shortcode-list");
    const codeNodes = shortcodeList.querySelectorAll("code");
    expect(codeNodes).toHaveLength(8);
  });

  it("shows a loading state distinct from an error or empty state", () => {
    state.isLoading = true;

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("status", { name: /loading/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a distinct error state on a failed fetch, rather than silently rendering as if there were no data", () => {
    state.isError = true;

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Memorandum body")).not.toBeInTheDocument();
  });

  it("shows the last send when present", () => {
    state.data = makeMemoContext({
      lastSend: {
        id: "memo-1",
        recipientName: "Dato' Ahmad",
        recipientEmail: "ahmad@example.com",
        cc: null,
        replyTo: "governance@mapim.org",
        subject: "Memorandum",
        bodyHtml: "<p>Hi</p>",
        sentAt: "2026-03-05T00:00:00.000Z",
      },
    });

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("last-send")).toBeInTheDocument();
    expect(screen.getByText(/Dato' Ahmad/)).toBeInTheDocument();
    expect(screen.getByText(/ahmad@example\.com/)).toBeInTheDocument();
  });

  it("shows no last-send notice when none exists — not inviting a duplicate, but also not implying one happened", () => {
    state.data = makeMemoContext({ lastSend: null });

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("last-send")).not.toBeInTheDocument();
    expect(screen.getByTestId("no-last-send")).toBeInTheDocument();
  });

  it("replyTo defaults to governance@mapim.org when the user does not change it", () => {
    state.data = makeMemoContext();

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/reply-to/i)).toHaveValue(
      "governance@mapim.org",
    );
  });

  it("sending calls the mutation with the edited Markdown, the recipient, the CC list and the reply-to — the argument shape, not merely a call", async () => {
    const user = userEvent.setup();
    state.data = makeMemoContext();

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/recipient name/i), "Dato' Ahmad");
    await user.type(
      screen.getByLabelText(/recipient email/i),
      "ahmad@example.com",
    );
    await user.type(
      screen.getByLabelText(/extra notes/i),
      "Please respond soon",
    );

    await user.type(screen.getByLabelText(/^cc$/i), "cc1@example.com");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await user.type(screen.getByLabelText(/^cc$/i), "cc2@example.com");
    await user.click(screen.getByRole("button", { name: /add/i }));

    const editor = screen.getByLabelText("Memorandum body");
    await user.clear(editor);
    await user.type(editor, "Edited memorandum body");

    await user.click(screen.getByRole("button", { name: /send memorandum/i }));

    expect(state.mutate).toHaveBeenCalledWith(
      {
        recipientName: "Dato' Ahmad",
        recipientEmail: "ahmad@example.com",
        notes: "Please respond soon",
        replyTo: "governance@mapim.org",
        cc: ["cc1@example.com", "cc2@example.com"],
        bodyMarkdown: "Edited memorandum body",
      },
      expect.anything(),
    );
  });

  it("surfaces a send failure via toast — an SMTP misconfiguration must read as a failure, not a silent success", async () => {
    const user = userEvent.setup();
    state.data = makeMemoContext();
    state.mutate.mockImplementation((_vars, options) => {
      options?.onError?.(
        new Error("Send memorandum failed: SMTP_NOT_CONFIGURED"),
      );
    });

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/recipient name/i), "Dato' Ahmad");
    await user.type(
      screen.getByLabelText(/recipient email/i),
      "ahmad@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send memorandum/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Send memorandum failed: SMTP_NOT_CONFIGURED",
      ),
    );
  });

  it("mentions the two-word 'Meeting Minutes' name rather than bare 'Minutes', to avoid the three-way ambiguity in this codebase", () => {
    state.data = makeMemoContext();

    render(
      <ActionConfigureDialog
        workspaceId="ws-1"
        meetingId="meeting-1"
        action={makeAction()}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Meeting Minutes/).length).toBeGreaterThan(0);
  });
});
