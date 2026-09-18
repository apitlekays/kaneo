import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  resetPdfTextExtractor,
  setPdfTextExtractor,
} from "../../apps/api/src/meeting/indexing";
import { getPrivateObject } from "../../apps/api/src/storage/s3";
import { settleBackgroundWork } from "../../apps/api/src/utils/background-work";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantGeneralManagement,
  type SeededMemberContext,
} from "./helpers/fixtures";

// Finalize computes the owner-segment prefix through
// `assertStorageConfigured`, so S3 must look configured even though nothing
// here talks to a bucket. Same fake, stable values as
// meeting-documents.test.ts.
process.env.S3_ENDPOINT ||= "http://localhost:9000";
process.env.S3_BUCKET ||= "kaneo-test-bucket";
process.env.S3_ACCESS_KEY_ID ||= "test-access-key";
process.env.S3_SECRET_ACCESS_KEY ||= "test-secret-key";

// The indexing pipeline pulls the PDF back out of storage before extracting,
// and there is no MinIO in the integration environment.
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return { ...actual, getPrivateObject: vi.fn(actual.getPrivateObject) };
});

type App = ReturnType<typeof createApp>["app"];

type MatchedDocument = {
  id: string;
  filename: string;
  kind: string;
  snippet: string;
};

type ListResponse = {
  items: Array<{
    id: string;
    title: string;
    matchedDocuments: MatchedDocument[];
  }>;
  nextCursor: string | null;
};

/**
 * A token that appears in no title, location, meeting type label or body
 * name anywhere in these fixtures — so a hit on it can only have come from
 * document text. The spec's own example word.
 */
const UNIQUE_WORD = "ZARZUELA";

function appFor(user: SeededMemberContext["user"]): App {
  mockAuthenticatedSession(user);
  return createApp().app;
}

function seedOwner(): Promise<SeededMemberContext> {
  return createWorkspaceMember({ role: "owner" });
}

/**
 * A General Management page holder who is deliberately NOT an attendee. The
 * only thing between this caller and a confidential meeting is the
 * visibility predicate — a plain stranger would be refused by the page check
 * regardless and would prove nothing about confidentiality.
 */
async function seedGmOfficer(
  workspaceId: string,
): Promise<SeededMemberContext> {
  const officer = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: officer.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantGeneralManagement(workspaceId, officer.user.id);
  return officer;
}

/**
 * Insert the meeting directly rather than through the route: these tests
 * need control over `scheduledAt` (distinct values, so an ordering
 * assertion is a property of the code rather than of insert luck) and over
 * `confidential`.
 */
async function seedMeeting(options: {
  workspaceId: string;
  title: string;
  confidential?: boolean;
  scheduledAt?: Date | null;
}): Promise<string> {
  const [row] = await db
    .insert(schema.meetingTable)
    .values({
      workspaceId: options.workspaceId,
      title: options.title,
      confidential: options.confidential ?? false,
      scheduledAt: options.scheduledAt ?? null,
    })
    .returning();
  return row.id;
}

/**
 * Finalize a MEETING-LEVEL (archival) document: no `actionUpdateId`, and a
 * `kind` that is not the reply-attachment default. `objectKey` carries a
 * storage-only segment that appears in no filename, so a route leaking the
 * key would be caught by name.
 */
function finalizeArchivalDocument(
  app: App,
  meetingId: string,
  body: {
    workspaceId: string;
    filename: string;
    objectKeyName: string;
    kind?: "transcript" | "minutes" | "other";
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
      size: 2048,
      kind: body.kind ?? "minutes",
    }),
  });
}

/**
 * Finalize an archival document whose extracted text is `text`, and wait
 * for the indexing queue to drain so it reaches `indexed`. Returns the
 * created document row's id.
 */
async function addIndexedDocument(
  app: App,
  meetingId: string,
  options: {
    workspaceId: string;
    filename: string;
    objectKeyName: string;
    text: string;
    kind?: "transcript" | "minutes" | "other";
  },
): Promise<string> {
  setPdfTextExtractor(async () => ({
    text: options.text,
    source: "layer" as const,
  }));
  const res = await finalizeArchivalDocument(app, meetingId, {
    workspaceId: options.workspaceId,
    filename: options.filename,
    objectKeyName: options.objectKeyName,
    kind: options.kind,
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  await settleBackgroundWork();
  const [row] = await db
    .select({ indexStatus: schema.meetingDocumentTable.indexStatus })
    .from(schema.meetingDocumentTable)
    .where(eq(schema.meetingDocumentTable.id, created.id))
    .limit(1);
  // A positive control on the fixture itself: every "does not match" case
  // below is worthless if the document silently never got indexed.
  expect(row?.indexStatus).toBe("indexed");
  return created.id;
}

function list(app: App, workspaceId: string, query = "") {
  return app.request(`/api/meeting?workspaceId=${workspaceId}${query}`);
}

function search(app: App, workspaceId: string, term: string, extra = "") {
  return list(app, workspaceId, `&q=${encodeURIComponent(term)}${extra}`);
}

/** Walk every page and return the ids in order. */
async function drain(app: App, workspaceId: string, query = "") {
  const ids: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const res = await list(
      app,
      workspaceId,
      `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    ids.push(...body.items.map((m) => m.id));
    cursor = body.nextCursor;
    guard += 1;
    if (guard > 20) throw new Error("pagination did not terminate");
  } while (cursor);
  return ids;
}

describe("API integration: archival document text search", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(getPrivateObject).mockImplementation(async (key: string) => ({
      body: Readable.from([Buffer.from(key)]),
      contentType: "application/pdf",
    }));
    setPdfTextExtractor(async () => ({ text: "placeholder", source: "layer" }));
  });

  afterEach(async () => {
    // Drain before swapping the extractor back, or a job still in flight
    // finishes against the real one.
    await settleBackgroundWork();
    resetPdfTextExtractor();
  });

  it("1. a word that exists only inside a PDF finds the meeting", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: "Quarterly Committee",
      scheduledAt: new Date("2026-03-01T09:00:00.000Z"),
    });
    await addIndexedDocument(app, meetingId, {
      workspaceId: ws,
      filename: "minit-jawatankuasa.pdf",
      objectKeyName: "stored-blob-aaa.pdf",
      text: `Perkara 4.2 dibentang oleh Setiausaha. Projek ${UNIQUE_WORD} diluluskan dengan syarat laporan audit dikemukakan sebelum mesyuarat akan datang.`,
    });

    // The word is in no metadata field, so a hit can only be a document hit.
    const res = await search(app, ws, UNIQUE_WORD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(body.items.map((m) => m.id)).toEqual([meetingId]);
    expect(body.items[0].matchedDocuments).toHaveLength(1);
    expect(body.items[0].matchedDocuments[0].filename).toBe(
      "minit-jawatankuasa.pdf",
    );
    expect(body.items[0].matchedDocuments[0].kind).toBe("minutes");
    expect(body.items[0].matchedDocuments[0].snippet).toContain(UNIQUE_WORD);
  });

  it("2. a non-attendee searching a word unique to a confidential meeting's PDF gets nothing", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const ownerApp = appFor(owner.user);

    const CONFIDENTIAL_TITLE = "Disciplinary hearing for Ahmad";
    const FILENAME = "siasatan-tatatertib.pdf";

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: CONFIDENTIAL_TITLE,
      confidential: true,
      scheduledAt: new Date("2026-04-01T09:00:00.000Z"),
    });
    await addIndexedDocument(ownerApp, meetingId, {
      workspaceId: ws,
      filename: FILENAME,
      objectKeyName: "stored-blob-bbb.pdf",
      text: `Laporan siasatan dalaman. Kes ${UNIQUE_WORD} melibatkan dokumen yang tidak dibenarkan diedarkan.`,
    });

    // Positive control FIRST: the fixture, the route and the search all
    // work for someone who may read the meeting. Without this, the
    // non-attendee assertions below would pass just as happily against a
    // broken fixture or a 404.
    const asOwner = (await (
      await search(ownerApp, ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    expect(asOwner.items.map((m) => m.id)).toEqual([meetingId]);
    expect(asOwner.items[0].matchedDocuments[0].snippet).toContain(UNIQUE_WORD);

    // The central test. Assert on the RAW body, not the parsed items: a
    // confidential meeting's title has escaped this module three times in
    // production, each through a field nobody had thought to guard, and a
    // snippet is content of exactly the same kind.
    const officer = await seedGmOfficer(ws);
    const res = await search(appFor(officer.user), ws, UNIQUE_WORD);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(UNIQUE_WORD);
    expect(raw).not.toContain(FILENAME);
    expect(raw).not.toContain(CONFIDENTIAL_TITLE);
    expect((JSON.parse(raw) as ListResponse).items).toEqual([]);

    // An attendee does get it…
    await db
      .insert(schema.meetingAttendeeTable)
      .values({ meetingId, userId: officer.user.id });
    const asAttendee = (await (
      await search(appFor(officer.user), ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    expect(asAttendee.items.map((m) => m.id)).toEqual([meetingId]);
    expect(asAttendee.items[0].matchedDocuments[0].snippet).toContain(
      UNIQUE_WORD,
    );

    // …and so does a global admin who is not an attendee. (The owner above
    // is that case, re-asserted here after the attendee row exists so the
    // two paths are not conflated.)
    const asAdmin = (await (
      await search(ownerApp, ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    expect(asAdmin.items.map((m) => m.id)).toEqual([meetingId]);
  });

  it("3. an unindexed document is not searchable", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: "Extraordinary General Meeting",
      scheduledAt: new Date("2026-05-01T09:00:00.000Z"),
    });

    // Hold the extractor open on a promise this test resolves, so "still
    // pending" is a fact rather than a race against the queue's microtasks.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPdfTextExtractor(async () => {
      await gate;
      return {
        text: `Usul khas: ${UNIQUE_WORD} dibincangkan.`,
        source: "layer" as const,
      };
    });

    const created = await finalizeArchivalDocument(app, meetingId, {
      workspaceId: ws,
      filename: "usul-khas.pdf",
      objectKeyName: "stored-blob-ccc.pdf",
    });
    expect(created.status).toBe(201);
    const doc = (await created.json()) as { id: string };

    const [pendingRow] = await db
      .select({ indexStatus: schema.meetingDocumentTable.indexStatus })
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.id, doc.id))
      .limit(1);
    expect(pendingRow?.indexStatus).toBe("pending");

    const whilePending = await search(app, ws, UNIQUE_WORD);
    expect(whilePending.status).toBe(200);
    const pendingRaw = await whilePending.text();
    expect(pendingRaw).not.toContain(UNIQUE_WORD);
    expect((JSON.parse(pendingRaw) as ListResponse).items).toEqual([]);

    release?.();
    await settleBackgroundWork();

    const [indexedRow] = await db
      .select({ indexStatus: schema.meetingDocumentTable.indexStatus })
      .from(schema.meetingDocumentTable)
      .where(eq(schema.meetingDocumentTable.id, doc.id))
      .limit(1);
    expect(indexedRow?.indexStatus).toBe("indexed");

    const afterIndexing = (await (
      await search(app, ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    expect(afterIndexing.items.map((m) => m.id)).toEqual([meetingId]);
    expect(afterIndexing.items[0].matchedDocuments[0].snippet).toContain(
      UNIQUE_WORD,
    );
  });

  it("4. search still paginates correctly when documents match", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);
    const limit = 2;
    const total = limit + 3;

    // DISTINCT scheduledAt values: an ordering assertion over ties passes by
    // luck, which has already happened once in this module.
    const created: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const meetingId = await seedMeeting({
        workspaceId: ws,
        // Titles carry no searchable token in common with the query, so
        // every hit below has to come through the document.
        title: `Sitting ${i}`,
        scheduledAt: new Date(`2026-06-0${i + 1}T09:00:00.000Z`),
      });
      await addIndexedDocument(app, meetingId, {
        workspaceId: ws,
        filename: `minit-${i}.pdf`,
        objectKeyName: `stored-blob-p${i}.pdf`,
        text: `Halaman ${i}: perkara ${UNIQUE_WORD} nombor ${i}.`,
      });
      created.push(meetingId);
    }

    // A meeting that matches nothing, to prove the search is doing work
    // rather than the pagination merely walking every row.
    await seedMeeting({
      workspaceId: ws,
      title: "Unrelated sitting",
      scheduledAt: new Date("2026-07-01T09:00:00.000Z"),
    });

    const ids = await drain(
      app,
      ws,
      `&limit=${limit}&q=${encodeURIComponent(UNIQUE_WORD)}`,
    );
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    expect([...ids].sort()).toEqual([...created].sort());
    // Newest scheduled first — the seeded dates ascend, so the order is the
    // reverse of creation.
    expect(ids).toEqual([...created].reverse());
  });

  it("5. a meeting with several matching documents returns each in matchedDocuments", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: "Committee with an archive",
      scheduledAt: new Date("2026-08-01T09:00:00.000Z"),
    });
    const kinds = ["minutes", "transcript", "other"] as const;
    for (let i = 0; i < kinds.length; i += 1) {
      const kind = kinds[i];
      await addIndexedDocument(app, meetingId, {
        workspaceId: ws,
        filename: `lampiran-${i}.pdf`,
        objectKeyName: `stored-blob-m${i}.pdf`,
        text: `Lampiran ${i} menyebut ${UNIQUE_WORD} pada perkara ${i}.`,
        kind,
      });
    }

    const body = (await (
      await search(app, ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    // One hit per MEETING, not per document: a join instead of an EXISTS
    // subquery would multiply the rows here and corrupt the cursor.
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(meetingId);
    expect(body.items[0].matchedDocuments).toHaveLength(3);
    expect(
      body.items[0].matchedDocuments.map((d) => d.filename).sort(),
    ).toEqual(["lampiran-0.pdf", "lampiran-1.pdf", "lampiran-2.pdf"]);
    for (const doc of body.items[0].matchedDocuments) {
      expect(doc.snippet).toContain(UNIQUE_WORD);
    }
  });

  it("6. a metadata match still works and reports no matched documents", async () => {
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: "Budget review",
      scheduledAt: new Date("2026-09-01T09:00:00.000Z"),
    });
    // An indexed document that does NOT contain the query term, so a
    // document condition wrongly ORed as a tautology would show up here.
    await addIndexedDocument(app, meetingId, {
      workspaceId: ws,
      filename: "lampiran-belanjawan.pdf",
      objectKeyName: "stored-blob-ddd.pdf",
      text: `Tiada perkaitan: ${UNIQUE_WORD} sahaja.`,
    });

    const body = (await (
      await search(app, ws, "budget")
    ).json()) as ListResponse;
    expect(body.items.map((m) => m.id)).toEqual([meetingId]);
    expect(body.items[0].matchedDocuments).toEqual([]);

    // And the plain, unsearched list carries an empty array rather than
    // omitting the field — the web types are built against a fixed shape.
    const all = (await (await list(app, ws)).json()) as ListResponse;
    expect(all.items[0].matchedDocuments).toEqual([]);
  });

  it("7. a reply attachment is not an archival document and is not searched", async () => {
    // `actionUpdateId IS NULL` is the archival filter. A reply attachment
    // carrying the term must not make its meeting a search hit, or the
    // Minutes library would surface correspondence-style replies as archive
    // documents.
    const owner = await seedOwner();
    const ws = owner.workspace.id;
    const app = appFor(owner.user);

    const meetingId = await seedMeeting({
      workspaceId: ws,
      title: "Meeting with a reply attachment",
      scheduledAt: new Date("2026-10-01T09:00:00.000Z"),
    });
    const docId = await addIndexedDocument(app, meetingId, {
      workspaceId: ws,
      filename: "balasan.pdf",
      objectKeyName: "stored-blob-eee.pdf",
      text: `Balasan menyebut ${UNIQUE_WORD}.`,
    });

    // Positive control: it IS a hit while it is meeting-level.
    const before = (await (
      await search(app, ws, UNIQUE_WORD)
    ).json()) as ListResponse;
    expect(before.items.map((m) => m.id)).toEqual([meetingId]);

    // Re-point it at an action update. The column is a bare text reference,
    // so a synthetic id is enough to exercise the predicate.
    await db.execute(
      sql`update "meeting_document" set "action_update_id" = 'synthetic-update-id' where "id" = ${docId}`,
    );

    const after = await search(app, ws, UNIQUE_WORD);
    expect(after.status).toBe(200);
    const raw = await after.text();
    expect(raw).not.toContain(UNIQUE_WORD);
    expect((JSON.parse(raw) as ListResponse).items).toEqual([]);
  });
});
