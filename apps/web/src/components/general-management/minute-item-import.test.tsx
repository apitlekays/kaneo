import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toCsv } from "@/lib/csv";
import { MinuteItemImport } from "./minute-item-import";

// The mutation itself (URL, body shape, 400 → readable message) is covered
// by fetchers/meeting/import.test.ts. This suite is about the component's
// own wiring: template contents, the preview-before-commit step, the
// mapped rows reaching the mutation, and row-numbered error rendering.
const mockImportMinuteItems = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/meeting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/fetchers/meeting")>();
  return {
    ...actual,
    importMinuteItems: (...args: Parameters<typeof actual.importMinuteItems>) =>
      mockImportMinuteItems(...args),
  };
});

const mockDownloadText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/csv")>();
  return {
    ...actual,
    downloadText: (...args: Parameters<typeof actual.downloadText>) =>
      mockDownloadText(...args),
  };
});

const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

function renderImport(onImported = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Spied before render so a success handler's invalidateQueries call is
  // caught regardless of when it fires.
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MinuteItemImport
        workspaceId="ws-1"
        meetingId="meeting-1"
        onImported={onImported}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onImported, invalidate };
}

function makeCsvFile(text: string) {
  return new File([text], "minute-items.csv", { type: "text/csv" });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("MinuteItemImport", () => {
  it("downloads a template whose header row is exactly numbering,topic,details,status,action", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.click(
      screen.getByRole("button", { name: /download template/i }),
    );

    expect(mockDownloadText).toHaveBeenCalledTimes(1);
    const [, text] = mockDownloadText.mock.calls[0];
    const header = String(text).split("\n")[0];
    expect(header).toBe("numbering,topic,details,status,action");
  });

  it("previews parsed rows, marking which ones become actions, before importing anything", async () => {
    const user = userEvent.setup();
    renderImport();

    const csv = toCsv(
      [
        {
          numbering: "1.1",
          topic: "Approve the annual budget",
          details: "Board approved FY2027 budget",
          status: "Approved",
          action: "",
        },
        {
          numbering: "1.2",
          topic: "Circulate the approved budget",
          details: "",
          status: "",
          action: "/",
        },
      ],
      ["numbering", "topic", "details", "status", "action"],
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    expect(await screen.findByText("Approve the annual budget")).toBeVisible();
    expect(screen.getByText("Circulate the approved budget")).toBeVisible();

    // Tied to each row's own container, not a page-wide `/action/i` text
    // search — that would also match the dialog's own copy about actions
    // and pass even if the badge were on the wrong row (or missing).
    const previewRows = screen.getAllByTestId("minute-item-import-row");
    const actionRow = previewRows.find((row) =>
      within(row).queryByText("Circulate the approved budget"),
    );
    const nonActionRow = previewRows.find((row) =>
      within(row).queryByText("Approve the annual budget"),
    );
    if (!actionRow || !nonActionRow) throw new Error("Expected both rows");
    expect(within(actionRow).getByText("Action")).toBeVisible();
    expect(within(nonActionRow).queryByText("Action")).not.toBeInTheDocument();

    // Nothing committed yet — the preview is shown before the mutation runs.
    expect(mockImportMinuteItems).not.toHaveBeenCalled();
  });

  it("labels each previewed row with its own row number, consistent with how a later 400 numbers rows (blank lines already dropped by parseCsv)", async () => {
    const user = userEvent.setup();
    renderImport();

    // A blank separator line — routine in a spreadsheet export — is dropped
    // entirely by parseCsv before anything is numbered, so the second data
    // row's own row number is 3 here, not the 4 a spreadsheet viewer would
    // call it. The point is that this number is the same one a 400 for this
    // exact file would report, not that it matches Excel.
    const csv = [
      "numbering,topic,details,status,action",
      '"1.1","Approve the annual budget","","",""',
      ",,,,",
      '"1.2","Circulate the approved budget","","","/"',
    ].join("\n");

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    expect(await screen.findByText(/^row 2 · 1\.1/i)).toBeVisible();
    expect(screen.getByText(/^row 3 · 1\.2/i)).toBeVisible();
    expect(screen.getByText(/blank lines are ignored/i)).toBeVisible();
  });

  it("sends the mapped rows to the mutation when the user commits the import", async () => {
    const user = userEvent.setup();
    mockImportMinuteItems.mockResolvedValue({
      itemsCreated: 1,
      actionsCreated: 0,
    });
    renderImport();

    const csv = toCsv(
      [
        {
          numbering: "1.1",
          topic: "Approve the annual budget",
          details: "",
          status: "",
          action: "",
        },
      ],
      ["numbering", "topic", "details", "status", "action"],
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await screen.findByText("Approve the annual budget");
    await user.click(screen.getByRole("button", { name: /^import \d+$/i }));

    expect(mockImportMinuteItems).toHaveBeenCalledWith("ws-1", "meeting-1", [
      {
        numbering: "1.1",
        topic: "Approve the annual budget",
        details: undefined,
        status: undefined,
        action: undefined,
      },
    ]);
  });

  it("renders a 400's row-numbered error message instead of silently failing", async () => {
    const user = userEvent.setup();
    mockImportMinuteItems.mockRejectedValue(
      new Error("Row 4: topic is required (and 1 more)"),
    );
    renderImport();

    const csv = toCsv(
      [
        {
          // parseCsv drops an all-blank line as a blank row, so this row
          // needs at least one non-empty cell to survive parsing while
          // still leaving `topic` empty — the exact case the server's 400
          // reports.
          numbering: "1.1",
          topic: "",
          details: "",
          status: "",
          action: "",
        },
      ],
      ["numbering", "topic", "details", "status", "action"],
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^import \d+$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /row 4: topic is required/i,
    );
  });

  it("renders every row's error when the server attached the full list, not just the first", async () => {
    const user = userEvent.setup();
    // What the fetcher actually throws for a multi-row 400: a one-line
    // `.message` (used for the toast) plus the full `.rowErrors` array —
    // see fetchers/meeting/import.test.ts's "attaches the full row-error
    // list" case for where this shape comes from.
    mockImportMinuteItems.mockRejectedValue(
      Object.assign(new Error("Row 3: topic is required (and 1 more)"), {
        rowErrors: [
          { row: 3, message: "topic is required" },
          { row: 5, message: "status is required" },
        ],
      }),
    );
    renderImport();

    const csv = toCsv(
      [{ numbering: "1.1", topic: "", details: "", status: "", action: "" }],
      ["numbering", "topic", "details", "status", "action"],
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^import \d+$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/row 3: topic is required/i);
    expect(alert).toHaveTextContent(/row 5: status is required/i);
  });

  it("invalidates the meeting query and calls onImported after a successful import", async () => {
    const user = userEvent.setup();
    mockImportMinuteItems.mockResolvedValue({
      itemsCreated: 2,
      actionsCreated: 1,
    });
    const { onImported, invalidate } = renderImport();

    const csv = toCsv(
      [
        {
          numbering: "",
          topic: "Approve the annual budget",
          details: "",
          status: "",
          action: "",
        },
      ],
      ["numbering", "topic", "details", "status", "action"],
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await screen.findByText("Approve the annual budget");
    await user.click(screen.getByRole("button", { name: /^import \d+$/i }));

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    // The load-bearing half: MinuteItemImport is mounted without an
    // `onImported` prop in production (meeting-detail-dialog.tsx), so the
    // Minute Items and Actions tabs refreshing depends entirely on this
    // call, not on `onImported`.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["meeting", "ws-1", "meeting-1"],
    });
  });
});
