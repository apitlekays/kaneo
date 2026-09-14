import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finalizeMeetingDocument,
  listActionUpdates,
  meetingDocumentDownloadUrl,
  postActionUpdate,
  presignMeetingDocument,
  uploadMeetingDocument,
} from "./index";

/**
 * The URL assertions matter as much as the response ones: a trailing-slash
 * 404 already shipped once in this module because integration tests call
 * routes directly and nothing exercised the client's URL construction. Same
 * risk class here — action-update and attachment routes are nested one level
 * deeper than the collection routes `list.test.ts` covers.
 */
function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listActionUpdates", () => {
  it("requests the thread with no trailing slash and the workspaceId query param", async () => {
    const fetchMock = mockFetchOnce([]);
    await listActionUpdates("ws-1", "meeting-1", "action-1");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain("/meeting/meeting-1/actions/action-1/updates?");
    expect(requested).not.toContain("/updates/?");
    expect(requested).toContain("workspaceId=ws-1");
  });

  it("returns the thread rows as-is", async () => {
    mockFetchOnce([
      {
        id: "update-1",
        actionId: "action-1",
        authorId: "user-1",
        body: "Started",
        statusAfter: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const rows = await listActionUpdates("ws-1", "meeting-1", "action-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Started");
  });
});

describe("postActionUpdate", () => {
  it("posts to the thread with no trailing slash", async () => {
    const fetchMock = mockFetchOnce({
      id: "update-2",
      actionId: "action-1",
      authorId: "user-1",
      body: "Done",
      statusAfter: "done",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await postActionUpdate("ws-1", "meeting-1", "action-1", {
      body: "Done",
      statusAfter: "done",
    });
    const [requestedUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestedUrl)).toBe(
      "http://localhost:1337/api/meeting/meeting-1/actions/action-1/updates",
    );
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      workspaceId: "ws-1",
      body: "Done",
      statusAfter: "done",
    });
  });

  it("omits statusAfter when not given", async () => {
    const fetchMock = mockFetchOnce({
      id: "update-3",
      actionId: "action-1",
      authorId: "user-1",
      body: "Just a note",
      statusAfter: null,
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    await postActionUpdate("ws-1", "meeting-1", "action-1", {
      body: "Just a note",
    });
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({ workspaceId: "ws-1", body: "Just a note" });
  });

  it("surfaces a hand-thrown plain-text HTTPException body as the error message", async () => {
    // A hand-thrown HTTPException's body is a raw plain-text string, not
    // JSON — mock `.text()` directly rather than through `mockFetchOnce`,
    // which always serializes its body as JSON.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Update body required",
      }),
    );
    await expect(
      postActionUpdate("ws-1", "meeting-1", "action-1", { body: "" }),
    ).rejects.toThrow("Update body required");
  });
});

describe("presignMeetingDocument", () => {
  it("requests the presign route with no trailing slash", async () => {
    const fetchMock = mockFetchOnce({
      key: "workspace/ws-1/meeting/meeting-1/file.pdf",
      uploadUrl: "https://storage.example/put",
      headers: { "Content-Type": "application/pdf" },
    });
    await presignMeetingDocument("ws-1", "meeting-1", {
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      actionUpdateId: "update-1",
    });
    const [requestedUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestedUrl)).toBe(
      "http://localhost:1337/api/meeting/meeting-1/attachments/presign",
    );
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      workspaceId: "ws-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      actionUpdateId: "update-1",
    });
  });
});

describe("finalizeMeetingDocument", () => {
  it("requests the finalize route with no trailing slash", async () => {
    const fetchMock = mockFetchOnce({
      id: "doc-1",
      meetingId: "meeting-1",
      actionUpdateId: "update-1",
      workspaceId: "ws-1",
      objectKey: "workspace/ws-1/meeting/meeting-1/file.pdf",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      sha256: null,
      kind: "original",
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await finalizeMeetingDocument("ws-1", "meeting-1", {
      objectKey: "workspace/ws-1/meeting/meeting-1/file.pdf",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      actionUpdateId: "update-1",
    });
    const [requestedUrl] = fetchMock.mock.calls[0];
    expect(String(requestedUrl)).toBe(
      "http://localhost:1337/api/meeting/meeting-1/attachments/finalize",
    );
  });
});

describe("uploadMeetingDocument", () => {
  /** presign -> PUT to storage -> finalize, in that order. */
  function mockUploadSequence() {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          key: "workspace/ws-1/meeting/meeting-1/file.pdf",
          uploadUrl: "https://storage.example/put",
          headers: { "Content-Type": "application/pdf" },
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "doc-1" }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // NOT "sends the file's own type": `isPdfUpload` guarantees the value is
  // "application/pdf" whatever the file reports, so that name described a
  // tautology. What is worth pinning is that BOTH requests carry the same
  // type, since finalize's stored row is what the download route trusts.
  it("sends application/pdf to presign and finalize alike", async () => {
    const fetchMock = mockUploadSequence();
    const file = new File(["%PDF-1.4"], "report.pdf", {
      type: "application/pdf",
    });

    await uploadMeetingDocument("ws-1", "meeting-1", file, "update-1");

    const presignBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const finalizeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(presignBody.mimeType).toBe("application/pdf");
    expect(finalizeBody.mimeType).toBe("application/pdf");
  });

  // The client used to hard-code `mimeType: "application/pdf"` on every
  // request regardless of the file, so the server's PDF-only check could
  // only ever validate a claim this client fabricated. It now sends
  // `file.type` — except for the ONE case `isPdfUpload` deliberately
  // admits: empty `type` plus a `.pdf` extension, which is how several
  // Android file providers report a perfectly good PDF. Sending "" there
  // would have the server refuse a file the client had just accepted,
  // breaking an upload path this codebase supports on purpose (see the
  // comment in `is-pdf-upload.ts`).
  //
  // This does leave payload.exe-renamed-to-payload.pdf accepted. That hole
  // is NOT closed by sending "": a rename is equally reachable by a caller
  // that simply claims `application/pdf`, so refusing the empty-type case
  // costs legitimate uploads and buys nothing. It is closed only by reading
  // the bytes — a magic-byte check at finalize, tracked separately. Note
  // the blast radius is bounded meanwhile: the presigned PUT binds
  // Content-Type into its signature, and the download route sends
  // `X-Content-Type-Options: nosniff`, so a mislabelled file is stored
  // wrongly rather than executed.
  it("falls back to application/pdf only for the empty-type .pdf case isPdfUpload allows", async () => {
    const fetchMock = mockUploadSequence();
    const file = new File(["%PDF-1.4"], "scan.pdf", { type: "" });

    await uploadMeetingDocument("ws-1", "meeting-1", file, "update-1");

    const presignBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const finalizeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(presignBody.mimeType).toBe("application/pdf");
    expect(finalizeBody.mimeType).toBe("application/pdf");
  });

  it("refuses a non-PDF type outright rather than relabelling it", async () => {
    // The fallback must not become a blanket relabel: a browser-reported
    // type that is neither empty nor application/pdf is rejected by
    // `isPdfUpload` before any request goes out. Asserting zero fetches is
    // what makes this bite — a toast-only assertion would still pass if the
    // request were sent anyway.
    const fetchMock = mockUploadSequence();
    const file = new File(["MZ"], "payload.exe", {
      type: "application/octet-stream",
    });

    await expect(
      uploadMeetingDocument("ws-1", "meeting-1", file, "update-1"),
    ).rejects.toThrow(/only pdf/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("meetingDocumentDownloadUrl", () => {
  it("builds the download URL with no trailing slash and the workspaceId query param", () => {
    const href = meetingDocumentDownloadUrl("ws-1", "meeting-1", "doc-1");
    expect(href).toBe(
      "http://localhost:1337/api/meeting/meeting-1/attachments/doc-1/download?workspaceId=ws-1",
    );
  });
});
