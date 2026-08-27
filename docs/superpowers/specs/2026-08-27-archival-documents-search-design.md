# Archival Documents and Full-Text Search

**Date:** 2026-08-27
**Status:** Approved for planning
**Covers:** requirement 3 of
`2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`
**Spec 4 of 4.** Extends Spec A's omni search. Deliberately last: it is the
only part that adds new infrastructure.

## Problem

Meetings held before this system existed have their record in PDFs —
transcripts and signed minute documents. Those need to live with the meeting,
and to be findable by what is *written inside them*, not just by title and
date.

## What already exists and is reused

The web app already has, all tested:

- `apps/web/src/lib/is-pdf-upload.ts` — PDF validation
- `apps/web/src/lib/compress-pdf.ts` and `hooks/use-pdf-compression.ts`
- `apps/web/src/lib/pdf-engine.ts`

And the server has a proven upload path: presign → PUT to MinIO → finalize,
with `letter_attachment` recording `objectKey`, `filename`, `mimeType`,
`size`, `sha256`, `kind`.

**Reuse all of it.** In particular, presign and finalize must share **one**
authorisation gate. The correspondence module shipped a version where only
finalize was gated, which left the feature unreachable because the caller
could not obtain an upload URL.

## Schema

### `meeting_document`

`id`, `meetingId` (FK cascade), `kind` (`transcript | minutes | other`),
`filename`, `mimeType`, `size`, `sha256`, `uploadedBy` (FK user, set null),
`createdAt`.

Storage keys, because both copies are kept:

- `objectKey` — the **compressed** copy, which is what gets served.
- `originalObjectKey` — the **original**, retained as the archival record.

Minutes are legal records; a compression artefact that eats a signature or a
stamp must not be the only surviving copy. This **doubles** storage rather
than reducing it — the VPS is at ~9% of 96 GB, so there is room, but disk
growth is now a thing to watch rather than assume.

Indexing state, because extraction is asynchronous:

- `indexStatus` — `pending | indexed | failed`
- `indexedAt`, `indexError` (nullable)
- `extractedText text` (nullable) and a generated `tsvector` column with a
  **GIN index**. Store the text as well as the vector: a snippet needs the
  original.

**The attachment link Spec C depends on is decided here**, since C deferred
it to whichever shape D made coherent: a nullable **`actionUpdateId`** on
this table, no FK constraint, exactly mirroring
`letter_attachment.minuteUpdateId`. A row with `actionUpdateId` set is an
attachment on a reply; a row with it null is a meeting-level archival
document. If C ships before D, C creates the column with the same name and
shape and D extends the table around it.

`meetingId` stays **not null on both kinds**, including reply attachments —
it is what makes one confidentiality check cover every attachment path
rather than two rules that can drift apart.

## Upload

- **PDF only**, enforced on **both** presign and finalize through the shared
  gate — client validation with `is-pdf-upload` is a convenience, never the
  boundary.
- The client compresses with the existing `compress-pdf` and uploads **both**
  copies. Compression stays client-side because it already exists, is tested,
  and keeps CPU off a 2-vCPU box that also runs Postgres, MinIO and the app.
- **A meeting holds many documents.** Nothing about the schema or UI may
  assume one.
- Displayed in the meeting's **Overview tab**, each row showing kind,
  filename, size, who uploaded it, and its **indexing state**.

## Extraction and OCR

Asynchronous, on the server, after finalize.

1. Extract the PDF's text layer.
2. If it yields nothing meaningful, run **OCR** — archival scans usually have
   no text layer, which is the whole reason OCR is here.
3. Write `extractedText`, set `indexStatus = indexed`, stamp `indexedAt`.
4. On failure set `failed` and record `indexError`. **A failed index must be
   visible and retryable**, not silent.

**The background work MUST be registered with `trackBackgroundWork`**
(`apps/api/src/utils/background-work.ts`). Untracked fire-and-forget database
work has deadlocked this repo's test harness **twice** — the second time one
layer deeper than the first fix reached, because `createNotification` voided
a promise the tracker never saw. Any promise that touches the database from
outside a request must be registered, or the integration suite will truncate
underneath it.

OCR is CPU-heavy on 2 vCPU. Process **one document at a time**, and treat a
large scan taking minutes as normal rather than as something to rush.

### The "indexing" state is not optional

A document that is uploaded but not yet indexed is invisible to search. If
the UI does not say so, the user concludes search is broken — the same
failure class as this module's list, where an errored query rendered
identically to an empty one. Show `Indexing…` on the row, and say plainly in
the search UI when results may be incomplete because documents are still
indexing.

## Search

Extend Spec A's single `q` parameter. No second search box.

A meeting matches when its metadata matches **or** any document belonging to
it matches on `extractedText`. Return, per hit, which document matched and a
short snippet, so a result explains itself.

### Confidentiality — the new leak surface

**Full-text search over documents is a brand-new way to leak a confidential
meeting.** A snippet is content, and a search result carrying one from a
meeting the searcher may not read is a disclosure, even if the meeting itself
never appears as a card.

The same visibility predicate Spec A moves into SQL must constrain the
document join **in the same query**. Not as a post-filter — that reintroduces
the pagination problem, and here it would mean fetching confidential snippets
into memory before discarding them.

A confidential meeting's title has escaped this module three times, each
through a path nobody thought of. Search is the fourth candidate. The test
must assert that a non-attendee searching for a **word that exists only
inside a confidential meeting's PDF** gets nothing — not merely that the
meeting card is absent.

## Testing

**Unit:** the extraction pipeline's decision to fall back to OCR; the
snippet builder.

**API integration:**
- Upload stores both copies; only the compressed one is served.
- A non-PDF is refused at **presign as well as finalize**.
- A document begins `pending` and reaches `indexed`, and its text becomes
  searchable — with the async work awaited via `settleBackgroundWork`, never
  a sleep.
- A failed extraction lands in `failed` with an error, and is retryable.
- A word unique to a confidential meeting's PDF returns nothing for a
  non-attendee, and everything for an attendee and for a global admin.
- Search still paginates correctly when documents match.
- A meeting with several documents returns each as its own hit.

**Web:** the Overview tab lists documents with their indexing state; a
non-PDF is rejected before upload; search results show which document matched.

## Out of scope

- Non-PDF formats.
- Re-OCR of already-indexed documents, beyond retrying a failure.
- Search across other modules. This `q` is the Meeting Minutes library's.
- Highlighting inside a rendered PDF.
- Deleting the original to reclaim disk. If storage becomes a problem, that
  is a deliberate decision with its own migration, not a default.
