import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingArchivalDocument } from "@/fetchers/meeting";
import { MeetingDocuments } from "./meeting-documents";

// The real fetchers run in this suite — only `global.fetch` is stubbed. That
// is deliberate: the two things most likely to be got wrong here are wire
// details (reindex's `workspaceId` belongs in the QUERY STRING, and the
// two-copy upload must not presign twice for a digital PDF), and mocking the
// fetcher module would assert nothing about either.
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [{ userId: "user-1", user: { name: "Alice Officer" } }],
      },
    }),
  }),
);

// pdf.js cannot run in jsdom, so the compression pass is stubbed — which also
// makes the "was it one copy or two?" branch directly controllable.
const mockCompress = vi.hoisted(() => vi.fn());
vi.mock("@/lib/compress-pdf", () => ({
  compressPdfIfScanned: (...args: unknown[]) => mockCompress(...args),
}));

type Call = { url: string; method: string; body?: string };

const state = vi.hoisted(() => ({
  docs: [] as MeetingArchivalDocument[],
  listStatus: 200,
  finalizeStatus: 201,
  holdFinalize: null as null | (() => void),
}));

let calls: Call[] = [];
let presignCount = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (url.includes("/documents?")) {
      return state.listStatus === 200
        ? json(state.docs)
        : json({ message: "Index shelf unavailable" }, state.listStatus);
    }
    if (url.includes("/reindex")) {
      return json({
        ...state.docs[0],
        indexStatus: "pending",
        indexError: null,
      });
    }
    if (url.includes("/attachments/presign")) {
      presignCount += 1;
      return json({
        key: `prefix/workspace/ws-1/meeting/meeting-1/copy-${presignCount}.pdf`,
        uploadUrl: `https://storage.test/put-${presignCount}`,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    if (url.startsWith("https://storage.test")) {
      return new Response(null, { status: 200 });
    }
    if (url.includes("/attachments/finalize")) {
      if (state.holdFinalize) {
        await new Promise<void>((resolve) => {
          state.holdFinalize = resolve;
        });
      }
      return state.finalizeStatus === 201
        ? json({ id: "doc-new" }, 201)
        : json(
            { message: "Document row was not written" },
            state.finalizeStatus,
          );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  },
);

function makeDoc(
  over: Partial<MeetingArchivalDocument> = {},
): MeetingArchivalDocument {
  return {
    id: "doc-1",
    filename: "agm-2025.pdf",
    size: 2_400_000,
    kind: "minutes",
    indexStatus: "indexed",
    indexedAt: "2026-09-01T00:00:00.000Z",
    indexError: null,
    createdBy: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function renderDocuments(canUpload = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MeetingDocuments
        meetingId="meeting-1"
        workspaceId="ws-1"
        canUpload={canUpload}
      />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

/**
 * `userEvent.upload` silently DROPS a file the input's `accept` attribute
 * rejects, which would make the non-PDF test vacuous — it would pass with the
 * component's guard deleted. `fireEvent.change` puts the file on the input
 * the way a drag-and-drop does, which is exactly the path the guard exists
 * for.
 */
function pickFile(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

function pdf(name = "scan.pdf", bytes = "x".repeat(2000)) {
  return new File([bytes], name, { type: "application/pdf" });
}

/** Everything except the list query — what "no upload request was made" means. */
function uploadCalls() {
  return calls.filter((call) => !call.url.includes("/documents?"));
}

function finalizeBody() {
  const call = calls.find((c) => c.url.includes("/attachments/finalize"));
  if (!call?.body) throw new Error("finalize was never called");
  return JSON.parse(call.body) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  presignCount = 0;
  state.docs = [];
  state.listStatus = 200;
  state.finalizeStatus = 201;
  state.holdFinalize = null;
  vi.stubGlobal("fetch", fetchMock);
  // A digital PDF: compression skips it, so only one copy is ever uploaded.
  mockCompress.mockImplementation(async (file: File) => ({
    file,
    originalSize: file.size,
    finalSize: file.size,
    skipped: "has-text",
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("MeetingDocuments", () => {
  it("lists each document with its kind and size", async () => {
    state.docs = [makeDoc()];
    renderDocuments();

    const row = await screen.findByTestId("meeting-document-row");
    expect(within(row).getByText("agm-2025.pdf")).toBeVisible();
    // Scoped to the row: "Meeting Minutes" is also the uploader's default
    // kind, so a page-wide text query would pass with the badge missing.
    expect(within(row).getByText("Meeting Minutes")).toBeVisible();
    expect(within(row).getByText("2.4 MB")).toBeVisible();
    expect(within(row).getByText("Alice Officer")).toBeVisible();
    expect(
      screen.queryByText("No documents uploaded yet."),
    ).not.toBeInTheDocument();
  });

  it("says Indexing… while a document is pending, so search looking empty is explained", async () => {
    state.docs = [makeDoc({ indexStatus: "pending", indexedAt: null })];
    renderDocuments();

    const row = await screen.findByTestId("meeting-document-row");
    expect(within(row).getByText(/Indexing…/)).toBeVisible();
    expect(within(row).getByText(/not searchable yet/)).toBeVisible();
  });

  it("shows a failed index with its error and a Retry control", async () => {
    const user = userEvent.setup();
    state.docs = [
      makeDoc({
        indexStatus: "failed",
        indexedAt: null,
        indexError: "OCR timed out after 120s",
      }),
    ];
    const { invalidate } = renderDocuments();

    const row = await screen.findByTestId("meeting-document-row");
    expect(within(row).getByRole("alert")).toHaveTextContent(
      /Indexing failed: OCR timed out after 120s/,
    );

    await user.click(within(row).getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/reindex"))).toBe(true);
    });
    const reindex = calls.find((c) => c.url.includes("/reindex")) as Call;
    expect(reindex.method).toBe("POST");
    // workspaceId in the QUERY STRING: the route is workspaceAccess.fromQuery,
    // so sending it in the body is rejected by the query validator.
    expect(reindex.url).toContain(
      "/meeting/meeting-1/documents/doc-1/reindex?workspaceId=ws-1",
    );
    expect(reindex.body).toBeUndefined();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["meeting-documents", "ws-1", "meeting-1"],
      });
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("toasts when a retry fails instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    state.docs = [
      makeDoc({ indexStatus: "failed", indexedAt: null, indexError: "boom" }),
    ];
    renderDocuments();

    const row = await screen.findByTestId("meeting-document-row");
    fetchMock.mockImplementationOnce(async () =>
      json({ message: "Queue is full" }, 500),
    );
    await user.click(within(row).getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Queue is full"),
      );
    });
  });

  it("distinguishes a failed LIST from an empty one", async () => {
    state.listStatus = 500;
    renderDocuments();

    expect(
      await screen.findByText(/Couldn't load this meeting's documents/),
    ).toBeVisible();
    // The bug this guards: an errored list rendering exactly like an empty
    // one, so users concluded the whole feature was broken.
    expect(
      screen.queryByText("No documents uploaded yet."),
    ).not.toBeInTheDocument();
  });

  it("rejects a non-PDF before any upload request is made", async () => {
    renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(new File(["hello"], "notes.txt", { type: "text/plain" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Only PDF files can be archived with a meeting",
      );
    });
    // The assertion that matters: nothing went out. A toast-only assertion
    // would pass even if the presign request had been sent anyway.
    expect(uploadCalls()).toHaveLength(0);
    expect(mockCompress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
  });

  it("disables the upload control while an upload is in flight", async () => {
    const user = userEvent.setup();
    // Any truthy value parks finalize until the handler swaps in its resolver.
    state.holdFinalize = () => {};
    renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(pdf());
    const button = screen.getByRole("button", { name: /upload/i });
    await user.click(button);

    // A native <button> (ui/button renders one), so toBeDisabled() is the
    // right assertion here — against a Base UI control that renders
    // <span role="…"> it would be a false negative and aria-disabled would
    // be the thing to check.
    await waitFor(() => expect(button).toBeDisabled());
    expect(fileInput()).toBeDisabled();

    state.holdFinalize?.();
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
  });

  it("surfaces a failed finalize after a successful PUT", async () => {
    const user = userEvent.setup();
    state.finalizeStatus = 500;
    renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(pdf("board-pack.pdf"));
    await user.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Document row was not written"),
      );
    });
    // Storage took the bytes; the row was never written.
    expect(calls.some((c) => c.url.startsWith("https://storage.test"))).toBe(
      true,
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // The picked file survives a failure — clearing it would leave the user
    // no way to retry. The Upload button is the honest witness: it is
    // enabled only while a file is held in state (`fireEvent`'s own `files`
    // property is defined on the element and would survive a reset, so
    // asserting on it would pass either way).
    expect(screen.getByRole("button", { name: /upload/i })).not.toBeDisabled();
  });

  it("invalidates the document list after a successful upload", async () => {
    const user = userEvent.setup();
    const { invalidate } = renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(pdf());
    await user.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["meeting-documents", "ws-1", "meeting-1"],
      });
    });
    expect(mockToastSuccess).toHaveBeenCalled();
    // Cleared only on success: the Upload button goes back to disabled
    // because no file is held any more.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled(),
    );
  });

  it("uploads ONE copy and no originalObjectKey when the PDF already has a text layer", async () => {
    const user = userEvent.setup();
    renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(pdf("digital.pdf"));
    await user.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(
      calls.filter((c) => c.url.includes("/attachments/presign")),
    ).toHaveLength(1);
    expect(
      calls.filter((c) => c.url.startsWith("https://storage.test")),
    ).toHaveLength(1);
    const body = finalizeBody();
    // Absent, not null: the server reads a missing original as "objectKey IS
    // the original". Uploading a second copy of every digital PDF would
    // double storage for no benefit.
    expect("originalObjectKey" in body).toBe(false);
    expect(body.kind).toBe("minutes");
    expect(body.filename).toBe("digital.pdf");
  });

  it("uploads BOTH copies when a scan was actually compressed", async () => {
    const user = userEvent.setup();
    const compressed = new File(["tiny"], "scan.pdf", {
      type: "application/pdf",
    });
    mockCompress.mockImplementation(async (file: File) => ({
      file: compressed,
      originalSize: file.size,
      finalSize: compressed.size,
      skipped: null,
    }));
    renderDocuments();
    await screen.findByText("No documents uploaded yet.");

    pickFile(pdf("scan.pdf"));
    await user.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(
      calls.filter((c) => c.url.includes("/attachments/presign")),
    ).toHaveLength(2);
    expect(
      calls.filter((c) => c.url.startsWith("https://storage.test")),
    ).toHaveLength(2);
    const body = finalizeBody();
    // First presigned key is the served (compressed) copy; second is the
    // untouched original.
    expect(body.objectKey).toContain("copy-1.pdf");
    expect(body.originalObjectKey).toContain("copy-2.pdf");
    expect(body.size).toBe(compressed.size);
  });

  it("hides the uploader from a user who may not attach", async () => {
    state.docs = [makeDoc({ indexStatus: "failed", indexError: "boom" })];
    renderDocuments(false);

    await screen.findByTestId("meeting-document-row");
    expect(
      screen.queryByRole("button", { name: /upload/i }),
    ).not.toBeInTheDocument();
    expect(fileInput()).toBeNull();
    // The retry spends OCR time, so it takes the upload gate too.
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });
});
