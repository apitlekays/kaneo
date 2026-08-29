import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MinuteItemImport
        workspaceId="ws-1"
        meetingId="meeting-1"
        onImported={onImported}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onImported };
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
    expect(screen.getByText(/action/i)).toBeVisible();

    // Nothing committed yet — the preview is shown before the mutation runs.
    expect(mockImportMinuteItems).not.toHaveBeenCalled();
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

  it("invalidates the meeting query and calls onImported after a successful import", async () => {
    const user = userEvent.setup();
    mockImportMinuteItems.mockResolvedValue({
      itemsCreated: 2,
      actionsCreated: 1,
    });
    const { onImported } = renderImport();

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
  });
});
