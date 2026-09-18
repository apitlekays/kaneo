import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  resetPdfTextExtractor,
  setPdfTextExtractor,
} from "../../apps/api/src/meeting/indexing";
import { extractPdfText } from "../../apps/api/src/meeting/pdf-text";
import { getPrivateObject } from "../../apps/api/src/storage/s3";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
} from "./helpers/fixtures";

// Finalize computes the owner-segment prefix through `assertStorageConfigured`,
// so S3 must look configured even though nothing here talks to a bucket. Same
// fake, stable values as meeting-action-updates.test.ts.
process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

// The indexing pipeline pulls the PDF back out of storage before extracting,
// and there is no MinIO in the integration environment. The stub hands back
// the OBJECT KEY as the body bytes on purpose: the injected extractor then
// receives a buffer that identifies which document it was handed, which is
// what makes the serialisation test below able to name the documents in the
// order they were indexed.
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, getPrivateObject: vi.fn(actual.getPrivateObject) };
});

const run = promisify(execFile);

const FIXTURE_TEXT =
  "MINIT MESYUARAT JAWATANKUASA — the archival text layer as extracted";

type App = ReturnType<typeof createApp>["app"];

function listDocuments(app: App, meetingId: string, workspaceId: string) {
  return app.request(
    `/api/meeting/${meetingId}/documents?workspaceId=${workspaceId}`,
  );
}

function reindexDocument(
  app: App,
  meetingId: string,
  docId: string,
  workspaceId: string,
) {
  return app.request(
    `/api/meeting/${meetingId}/documents/${docId}/reindex?workspaceId=${workspaceId}`,
    { method: "POST" },
  );
}

function presignAttachment(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    filename?: string;
    mimeType?: string;
    size?: number;
  },
) {
  return app.request(`/api/meeting/${meetingId}/attachments/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "minit-agm.pdf",
      mimeType: "application/pdf",
      size: 2048,
      ...body,
    }),
  });
}

/**
 * Finalize a MEETING-LEVEL (archival) document: no `actionUpdateId`, and a
 * `kind` that is not the reply-attachment default. `objectKey` carries a
 * storage-only segment (`stored-blob-*`) that appears in no filename, so a
 * route that leaked the key would be caught by name.
 */
function finalizeArchivalDocument(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    filename: string;
    objectKeyName: string;
    kind?: "transcript" | "minutes" | "other";
    size?: number;
  },
) {
  return app.request(`/api/meeting/${meetingId}/attachments/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: body.workspaceId,
      objectKey: `workspace/${body.workspaceId}/meeting/${meetingId}/${body.objectKeyName}`,
      filename: body.filename,
      mimeType: "application/pdf",
      size: body.size ?? 2048,
      kind: body.kind ?? "minutes",
    }),
  });
}

function loadDocumentRow(id: string) {
  return db
    .select()
    .from(schema.meetingDocumentTable)
    .where(eq(schema.meetingDocumentTable.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * The workspace owner is a global admin, so it holds the General Management
 * page and can read a confidential meeting without an explicit attendee row —
 * which is what lets one caller seed the archive in every case below.
 */
async function seedMeeting(options?: {
  confidential?: boolean;
  title?: string;
}) {
  const owner = await createWorkspaceMember({ role: "owner" });
  mockAuthenticatedSession(owner.user);
  const { app: ownerApp } = createApp();
  const created = await ownerApp.request("/api/meeting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: owner.workspace.id,
      title: options?.title ?? "Annual General Meeting 2026",
      confidential: options?.confidential ?? false,
    }),
  });
  expect(created.status).toBe(201);
  const meeting = await created.json();
  return { owner, ownerApp, meeting, workspaceId: owner.workspace.id };
}

/** A workspace member with no General Management page grant. */
async function seedPlainMember(workspaceId: string) {
  const member = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: member.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  return member;
}

/**
 * A General Management page holder who is deliberately NOT an attendee. The
 * only thing standing between this caller and a confidential meeting is
 * `assertCanReadMeeting` — a plain stranger would be refused by the page
 * check regardless and would prove nothing about confidentiality.
 */
async function seedGmOfficerNotAttendee(workspaceId: string) {
  const officer = await seedPlainMember(workspaceId);
  await grantGeneralManagement(workspaceId, officer.user.id);
  return officer;
}

function appFor(user: Parameters<typeof mockAuthenticatedSession>[0]) {
  mockAuthenticatedSession(user);
  return createApp().app;
}

describe("API integration: meeting archival documents", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(getPrivateObject).mockImplementation(async (key: string) => ({
      body: Readable.from([Buffer.from(key)]),
      contentType: "application/pdf",
    }));
    setPdfTextExtractor(async () => ({
      text: FIXTURE_TEXT,
      source: "layer",
    }));
  });

  afterEach(async () => {
    // Drain before swapping the extractor back, or a job still in flight
    // finishes against the real one.
    await settleBackgroundWork();
    resetPdfTextExtractor();
  });

  it("1. a document begins pending and reaches indexed", async () => {
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    const res = await finalizeArchivalDocument(ownerApp, meeting.id, {
      workspaceId,
      filename: "minit-agm-2026.pdf",
      objectKeyName: "stored-blob-aaa.pdf",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.indexStatus).toBe("pending");

    await settleBackgroundWork();

    const row = await loadDocumentRow(created.id);
    expect(row?.indexStatus).toBe("indexed");
    expect(row?.indexedAt).not.toBeNull();
    expect(row?.indexError).toBeNull();
    expect(row?.extractedText).toBe(FIXTURE_TEXT);
  });

  it("2. a failed extraction lands in failed with an error, and is retryable", async () => {
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    setPdfTextExtractor(async () => {
      throw new Error("poppler fell over");
    });

    const res = await finalizeArchivalDocument(ownerApp, meeting.id, {
      workspaceId,
      filename: "laporan-audit.pdf",
      objectKeyName: "stored-blob-bbb.pdf",
    });
    expect(res.status).toBe(201);
    const created = await res.json();

    await settleBackgroundWork();

    const failed = await loadDocumentRow(created.id);
    expect(failed?.indexStatus).toBe("failed");
    expect(failed?.indexError).not.toBeNull();
    expect(failed?.indexedAt).toBeNull();

    setPdfTextExtractor(async () => ({
      text: FIXTURE_TEXT,
      source: "layer",
    }));

    const retry = await reindexDocument(
      ownerApp,
      meeting.id,
      created.id,
      workspaceId,
    );
    expect(retry.status).toBe(200);
    const retried = await retry.json();
    // The route hands back the state it just wrote, so the UI can show the
    // spinner without a second round trip.
    expect(retried.indexStatus).toBe("pending");
    expect(retried.indexError).toBeNull();

    await settleBackgroundWork();

    const indexed = await loadDocumentRow(created.id);
    expect(indexed?.indexStatus).toBe("indexed");
    expect(indexed?.indexError).toBeNull();
    expect(indexed?.indexedAt).not.toBeNull();
    expect(indexed?.extractedText).toBe(FIXTURE_TEXT);
  });

  it("3. reindex refuses a caller who may not attach to the meeting, and does not touch indexStatus", async () => {
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    // Start from `failed`, so a route that wrongly reset the row to
    // `pending` is visible in the database even though the response was a
    // 403. Without this second assertion the test would pass against a
    // reindex that did the work and then failed to respond.
    setPdfTextExtractor(async () => {
      throw new Error("poppler fell over");
    });
    const res = await finalizeArchivalDocument(ownerApp, meeting.id, {
      workspaceId,
      filename: "kertas-kerja.pdf",
      objectKeyName: "stored-blob-ccc.pdf",
    });
    const created = await res.json();
    await settleBackgroundWork();
    expect((await loadDocumentRow(created.id))?.indexStatus).toBe("failed");

    // A plain workspace member on a NON-confidential meeting: it clears
    // `assertCanReadMeeting` (which is unconditionally true for a
    // non-confidential meeting) and is refused only by the page check inside
    // the attach gate. So this bites precisely when reindex takes the READ
    // gate instead of the UPLOAD gate — which is the regression it exists
    // to catch.
    const member = await seedPlainMember(workspaceId);
    const memberApp = appFor(member.user);
    const refused = await reindexDocument(
      memberApp,
      meeting.id,
      created.id,
      workspaceId,
    );
    expect(refused.status).toBe(403);

    const after = await loadDocumentRow(created.id);
    expect(after?.indexStatus).toBe("failed");
    expect(after?.indexError).not.toBeNull();
  });

  it("4. the list route returns each of several documents with its kind and indexStatus", async () => {
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    const kinds = ["minutes", "transcript", "other"] as const;
    const ids: string[] = [];
    for (const [i, kind] of kinds.entries()) {
      const res = await finalizeArchivalDocument(ownerApp, meeting.id, {
        workspaceId,
        filename: `dokumen-${i}.pdf`,
        objectKeyName: `stored-blob-${i}.pdf`,
        kind,
      });
      expect(res.status).toBe(201);
      ids.push((await res.json()).id);
    }

    await settleBackgroundWork();

    const res = await listDocuments(ownerApp, meeting.id, workspaceId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body.map((d: { id: string }) => d.id).sort()).toEqual(
      [...ids].sort(),
    );
    for (const [i, kind] of kinds.entries()) {
      const doc = body.find(
        (d: { filename: string }) => d.filename === `dokumen-${i}.pdf`,
      );
      expect(doc.kind).toBe(kind);
      expect(doc.indexStatus).toBe("indexed");
    }
  });

  it("5. the list route never returns a storage key, and omits reply attachments", async () => {
    const { owner, ownerApp, meeting, workspaceId } = await seedMeeting();

    const objectKeyName = "stored-blob-ddd-unique.pdf";
    const archival = await finalizeArchivalDocument(ownerApp, meeting.id, {
      workspaceId,
      filename: "minit-agm-2026.pdf",
      objectKeyName,
    });
    expect(archival.status).toBe(201);

    // A reply attachment on an action thread. It must NOT appear in the
    // archive list: it sits at `pending` forever by design (nothing indexes
    // thread attachments), so surfacing it would read as "queued" for ever.
    const actionRes = await ownerApp.request(
      `/api/meeting/${meeting.id}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          description: "Draft the audit response",
          assigneeId: owner.user.id,
        }),
      },
    );
    expect(actionRes.status).toBe(201);
    const action = await actionRes.json();
    const updateRes = await ownerApp.request(
      `/api/meeting/${meeting.id}/actions/${action.id}/updates`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, body: "Attaching my reply" }),
      },
    );
    expect(updateRes.status).toBe(201);
    const update = await updateRes.json();
    const replyAttachment = await ownerApp.request(
      `/api/meeting/${meeting.id}/attachments/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          objectKey: `workspace/${workspaceId}/meeting/${meeting.id}/stored-blob-reply.pdf`,
          filename: "balasan-tindakan.pdf",
          mimeType: "application/pdf",
          size: 1024,
          actionUpdateId: update.id,
        }),
      },
    );
    expect(replyAttachment.status).toBe(201);

    await settleBackgroundWork();

    const res = await listDocuments(ownerApp, meeting.id, workspaceId);
    expect(res.status).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("objectKey");
    expect(raw).not.toContain("original_object_key");
    expect(raw).not.toContain(objectKeyName);

    expect(body).toHaveLength(1);
    expect(body[0].filename).toBe("minit-agm-2026.pdf");
    expect(raw).not.toContain("balasan-tindakan.pdf");
  });

  it("6. a non-attendee cannot list a confidential meeting's documents, and nothing leaks", async () => {
    // Both the title and the filename carry a word that exists ONLY in this
    // meeting's data, so a leak through either is detectable by name.
    const { ownerApp, meeting, workspaceId } = await seedMeeting({
      confidential: true,
      title: "Sulit: Tribunal Zafiran",
    });
    const archival = await finalizeArchivalDocument(ownerApp, meeting.id, {
      workspaceId,
      filename: "kertas-rahsia-bendahari.pdf",
      objectKeyName: "stored-blob-eee.pdf",
    });
    expect(archival.status).toBe(201);
    await settleBackgroundWork();

    // Positive control: the route exists and does return this document to
    // someone entitled to it. Without this, the refusal below would pass
    // just as well against a route that does not exist at all (404) — the
    // shape of "test that passes for the wrong reason" this module keeps
    // producing.
    const allowed = await listDocuments(ownerApp, meeting.id, workspaceId);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("kertas-rahsia-bendahari");

    const officer = await seedGmOfficerNotAttendee(workspaceId);
    const officerApp = appFor(officer.user);
    const res = await listDocuments(officerApp, meeting.id, workspaceId);
    expect([403, 404]).toContain(res.status);

    const raw = await res.text();
    expect(raw).not.toContain("Zafiran");
    expect(raw).not.toContain("kertas-rahsia-bendahari");
  });

  it("7. a non-PDF is refused at presign as well as finalize", async () => {
    // Spec C already covers both halves for a reply attachment in
    // `meeting-action-updates.test.ts`, test
    // "13. a non-PDF is refused at presign as well as finalize, separately".
    // Repeated here for the MEETING-LEVEL path (no actionUpdateId), which is
    // this spec's own writer and takes a different branch of
    // `assertCanAttachMeetingDocument`.
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    const presignRes = await presignAttachment(ownerApp, meeting.id, {
      workspaceId,
      mimeType: "image/png",
      filename: "imbasan.png",
    });
    expect(presignRes.status).toBe(400);

    const finalizeRes = await ownerApp.request(
      `/api/meeting/${meeting.id}/attachments/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          objectKey: `workspace/${workspaceId}/meeting/${meeting.id}/imbasan.png`,
          filename: "imbasan.png",
          mimeType: "image/png",
          size: 1024,
          kind: "minutes",
        }),
      },
    );
    expect(finalizeRes.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.meetingId, meeting.id));
    expect(rows).toHaveLength(0);
  });

  it("8. a document from another meeting is not reachable through this meeting's reindex route", async () => {
    const a = await seedMeeting({ title: "Meeting A" });
    const createdA = await (
      await finalizeArchivalDocument(a.ownerApp, a.meeting.id, {
        workspaceId: a.workspaceId,
        filename: "milik-mesyuarat-a.pdf",
        objectKeyName: "stored-blob-fff.pdf",
      })
    ).json();

    const secondMeeting = await a.ownerApp.request("/api/meeting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: a.workspaceId,
        title: "Meeting B",
      }),
    });
    const meetingB = await secondMeeting.json();
    await settleBackgroundWork();

    // Positive control: through its OWN meeting the same document reindexes
    // fine, so the 404 below is the meeting scoping and not a missing route.
    const throughA = await reindexDocument(
      a.ownerApp,
      a.meeting.id,
      createdA.id,
      a.workspaceId,
    );
    expect(throughA.status).toBe(200);

    // Same caller, same workspace, fully authorised on both meetings: the
    // only thing that can refuse this is scoping the document lookup by the
    // meeting in the URL.
    const res = await reindexDocument(
      a.ownerApp,
      meetingB.id,
      createdA.id,
      a.workspaceId,
    );
    expect(res.status).toBe(404);
  });

  it("9. documents are indexed strictly one at a time, in order", async () => {
    const { ownerApp, meeting, workspaceId } = await seedMeeting();

    // The extractor records a start and an end event per call and blocks in
    // between on a release the test controls, so the test observes the
    // ORDER of the pipeline rather than its end state. End state is not
    // enough: swapping the serial queue for `Promise.all` still leaves all
    // three rows correctly `indexed`.
    const events: string[] = [];
    type Call = { name: string; release: () => void };
    const readyCalls: Call[] = [];
    const waiters: Array<(call: Call) => void> = [];
    // Every release handed out, so the `finally` below can let go of jobs
    // this test never got to release. Without it, a FAILING assertion (which
    // is the whole point of the test) would leave an extraction blocked for
    // ever and hang `settleBackgroundWork` in `afterEach` — a hang instead
    // of a readable failure.
    const allReleases: Array<() => void> = [];
    let draining = false;
    function publishCall(call: Call) {
      allReleases.push(call.release);
      const waiter = waiters.shift();
      if (waiter) waiter(call);
      else readyCalls.push(call);
    }
    function nextCall(): Promise<Call> {
      const queued = readyCalls.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<Call>((resolve) => waiters.push(resolve));
    }

    setPdfTextExtractor(async (pdf) => {
      // The storage stub hands back the object key as the body, so the
      // buffer names the document being indexed.
      const name = pdf.toString().split("/").pop() ?? "?";
      events.push(`start:${name}`);
      if (!draining)
        await new Promise<void>((resolve) => {
          publishCall({ name, release: resolve });
        });
      events.push(`end:${name}`);
      return { text: `text of ${name}`, source: "layer" };
    });

    const names = ["doc-one.pdf", "doc-two.pdf", "doc-three.pdf"];
    for (const [i, name] of names.entries()) {
      const res = await finalizeArchivalDocument(ownerApp, meeting.id, {
        workspaceId,
        filename: `arkib-${i}.pdf`,
        objectKeyName: name,
      });
      expect(res.status).toBe(201);
    }

    const observed: string[] = [];
    try {
      for (let i = 0; i < names.length; i++) {
        const call = await nextCall();
        observed.push(call.name);
        // Only one extraction may ever be in flight. Under a parallel queue
        // the later starts are already recorded by now.
        expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(
          i + 1,
        );
        call.release();
      }
    } finally {
      // Let go of anything still blocked, including jobs a failed assertion
      // above never reached, so the failure surfaces as a failure rather
      // than a hung drain.
      draining = true;
      for (const release of allReleases) release();
    }

    await settleBackgroundWork();

    // The deterministic assertion: strictly alternating start/end, in the
    // order the documents were enqueued. A parallel queue records two starts
    // before the first end, so this sequence cannot match.
    expect(events).toEqual([
      `start:${observed[0]}`,
      `end:${observed[0]}`,
      `start:${observed[1]}`,
      `end:${observed[1]}`,
      `start:${observed[2]}`,
      `end:${observed[2]}`,
    ]);
    expect(observed).toEqual(names);

    const rows = await db
      .select()
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.meetingId, meeting.id));
    expect(rows.every((r) => r.indexStatus === "indexed")).toBe(true);
  });
});

describe("the real PDF text extractor", () => {
  let hasPdfToText = false;

  beforeAll(async () => {
    try {
      await run("pdftotext", ["-v"]);
      hasPdfToText = true;
    } catch {
      hasPdfToText = false;
    }
  });

  it("10. reads the text layer of a generated PDF", async (ctx) => {
    // poppler is installed on the deployment box and on the maintainer's
    // machine, but not necessarily in CI — skip rather than fail there.
    if (!hasPdfToText) ctx.skip();

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    // Comfortably over `MIN_MEANINGFUL_CHARS` (100 non-whitespace
    // characters), so extraction stops at the text layer and never reaches
    // the OCR branch — which would need tesseract.
    const lines = [
      "MINIT MESYUARAT JAWATANKUASA TERTINGGI",
      "Bil 3/2026 bertarikh 14 September 2026",
      "Kehadiran: Presiden, Setiausaha Agung, Bendahari Kehormat",
      "Perkara 1: Pengesahan minit mesyuarat yang lalu telah diluluskan",
      "Perkara 2: Laporan kewangan dibentangkan oleh Bendahari Kehormat",
    ];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 48, y: 780 - i * 24, size: 12, font });
    });
    const bytes = await pdf.save();

    const result = await extractPdfText(Buffer.from(bytes));
    expect(result.source).toBe("layer");
    expect(result.text).toContain("MINIT MESYUARAT JAWATANKUASA TERTINGGI");
  });
});
