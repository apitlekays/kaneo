# Archival Documents and Full-Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a meeting carry many archival PDFs (transcripts, signed minutes), extract their text server-side with an OCR fallback for scans, and make meetings findable by what is written *inside* those PDFs through the existing `q` search parameter.

**Architecture:** `meeting_document` — created by Spec C for reply attachments — gains storage and indexing columns plus a generated `tsvector` with a GIN index. Finalize enqueues an asynchronous, strictly serial indexing job registered with `trackBackgroundWork`; the job pulls the PDF back out of object storage, tries the text layer via `pdftotext`, and falls back to rasterise-plus-OCR via `pdftoppm` + `tesseract` when the layer is empty. Spec A's list route gains one `EXISTS` subquery so a document-text match is applied inside the same confidentiality-filtered, keyset-paginated query rather than as a post-filter.

**Tech Stack:** Hono + Drizzle + Valibot + Postgres FTS (`tsvector`/GIN) on the API; `poppler-utils` and `tesseract-ocr` as Alpine packages invoked via `execFile`; React 19 + TanStack Query on the web, reusing the existing `compress-pdf` / `pdf-engine` / `is-pdf-upload` client tooling.

**Spec:** `docs/superpowers/specs/2026-08-27-archival-documents-search-design.md`

**Depends on:** Spec A (shipped — the `q` parameter and `visibilityCondition` this plan extends) and Spec C (branch `feat/action-follow-through` — the `meeting_document` table, the presign/finalize/download routes and their shared authorisation gate). **Do not start Task 2 until Spec C is merged to `main`**; this plan is written against C's branch shape, and Task 0 reconciles any drift the final review introduced.

---

## Global Constraints

- **Never conflate the three kinds of "minutes."** This spec touches only
  organisation-level **Meeting Minutes** (`meeting_*` tables). Do not read,
  write, rename or "tidy" `task_mom` or `letter_minute*`. UI copy says
  "Meeting Minutes", never bare "Minutes".
- **PDF only.** `MEETING_DOCUMENT_MIME_TYPE = "application/pdf"`, enforced
  server-side by `assertPdfOnly` on **both** presign and finalize through the
  single shared gate `assertCanAttachMeetingDocument`. Client-side
  `isPdfUpload` is a convenience, never the boundary.
- **One shared authorisation gate.** Do not add a second gate, and do not
  gate only one of presign/finalize. The correspondence module shipped a
  version gated only at finalize, which left the feature unreachable because
  the caller could never obtain an upload URL.
- **`meetingId` is NOT NULL on every `meeting_document` row**, including
  reply attachments. This is what lets one confidentiality check cover every
  attachment path instead of two rules that drift apart. Never relax it.
- **Every promise that touches the database after its request has responded
  MUST be registered with `trackBackgroundWork`**
  (`apps/api/src/utils/background-work.ts`). Untracked fire-and-forget DB
  work has deadlocked this repo's integration harness twice. Tests await
  `settleBackgroundWork()`, **never** a sleep.
- **`objectKey` and `originalObjectKey` never leave the API.** No route
  returns them in a response body. Downloads go through
  `GET /:id/attachments/:docId/download`.
- **OCR processes one document at a time**, process-wide. A large scan taking
  minutes is normal, not something to parallelise on a 2-vCPU box that also
  runs Postgres, MinIO and the app.
- **No user-supplied string ever reaches a shell.** Use `execFile` with an
  argument array — never `exec`, never a template-string command. Filenames
  are attacker-controlled.
- **A failed index must be visible and retryable**, never silent. An errored
  state must render differently from an empty one; this module already
  shipped a bug where an errored list rendered identically to an empty one
  and users concluded the feature was broken.
- **Confidentiality is the highest-risk surface in this spec.** A
  confidential meeting's title has escaped this module three times. A
  snippet is content: a search result carrying a snippet from a meeting the
  searcher may not read is a disclosure even if the meeting card never
  appears. The visibility predicate must constrain the document match **in
  the same SQL query**, not as a post-filter.
- Validation is Valibot; errors are `HTTPException`; routes carry
  `describeRoute`. Biome: double quotes, semicolons, spaces in TS/TSX.
- Migrations are additive only in this plan (new nullable columns, a new
  generated column, a new index). If a task appears to need a rename, a drop
  or a NOT NULL without a default, STOP and escalate — it changes the
  release to a **major** per CLAUDE.md.

---

## Rulings made while writing this plan

These resolve conflicts and gaps between the spec and the code as it
actually stands. Each is binding on the tasks below.

**R1 — `kind` carries four values, not three.** The spec says `kind` is
`transcript | minutes | other`, but Spec C already shipped the column as
`text("kind").notNull().default("original")` and never writes it, so every
existing row reads `"original"`. Ruling: the column's domain is
`original | transcript | minutes | other`. `"original"` stays the default and
is what reply attachments keep; a **meeting-level archival upload must send
one of `transcript | minutes | other` explicitly**, validated with
`v.picklist`. No migration and no backfill. *Cost if wrong:* a fourth value
in a column the spec described as three-valued — cosmetic, and cheaper than a
rename of live rows.

**R2 — extraction reads the ORIGINAL copy, never the served copy.**
`compressPdfIfScanned` **skips compression entirely when the PDF already has
a text layer** (`skipped: "has-text"`, `MIN_TEXT_CHARS = 100`) and only
rasterises true scans to JPEG. So a compressed copy never contains text worth
extracting, and for a scan the original is the higher-fidelity image and
therefore the better OCR input. *Cost if wrong:* OCR runs on larger files and
takes longer; accuracy is strictly better, never worse.

**R3 — `originalObjectKey` is nullable, and null means "`objectKey` IS the
original."** The spec says both copies are kept and that this doubles
storage. That doubling is real only for scans: a digital PDF is never
compressed (R2), so uploading it twice would store two byte-identical
objects. Ruling: the client uploads a second copy only when compression
actually happened; otherwise `originalObjectKey` stays null. The spec's
archival guarantee — an uncompressed original always survives — holds either
way. *Cost if wrong:* a consumer that assumes the column is always populated
must coalesce; call that out in the column comment.

**R4 — search returns one hit per MEETING, carrying a `matchedDocuments`
array.** The spec's testing section says both "a meeting with several
documents returns each as its own hit" and "search still paginates correctly
when documents match". Those conflict if a meeting emits one row per matching
document, because the keyset cursor is meeting-keyed (`scheduled_at`,
`created_at`, `id`) and row multiplication would make `limit + 1`
page-detection and the cursor both wrong — reintroducing precisely the
pagination class that took three bugs to get right. Ruling: one card per
meeting; each matching document appears as its own entry inside that card's
`matchedDocuments` array. Pagination semantics are untouched. *Cost if
wrong:* the grid shows one card where a design might have wanted three rows;
a presentation change, not a data change.

**R5 — native `poppler-utils` + `tesseract-ocr` via `execFile`, behind an
injectable seam.** Nothing server-side can read PDF text today: the API has
`pdf-lib` (which cannot extract text) and no OCR at all. The alternative was
pure-JS (`pdfjs-dist` + `tesseract.js`). Native wins because WASM OCR on 2
vCPU is several times slower, because `tesseract.js` fetches its language
data from a CDN at runtime (an availability and supply-chain dependency
inside a container), and because `pdftotext` is far more robust than
hand-rolled text extraction. The cost is real and must be paid in Task 1:
three Alpine packages in `Dockerfile.kaneo`, the same in `ci.yml`, and a
`brew install poppler tesseract` line for local development. To keep the
integration suite honest without requiring binaries everywhere, extraction
sits behind a single injectable interface: tests inject a fake, and **one**
test exercising the real binaries skips itself when they are absent. *Cost if
wrong:* if the Alpine packages do not resolve (Task 1 probes this BEFORE any
code is written), fall back to `pdfjs-dist` + `tesseract.js` with vendored
language data; only Task 3's implementation changes, because the seam is
already there.

**R6 — the `tsvector` uses the `'simple'` configuration.** A generated column
requires an IMMUTABLE expression, so the one-argument `to_tsvector(text)` is
rejected outright (it is STABLE — it reads `default_text_search_config`). The
two-argument form is immutable and must be used. `'simple'` rather than
`'english'` because these documents are mixed Malay and English and the
English stemmer mangles Malay words; `'simple'` lowercases and splits without
stemming. *Cost if wrong:* no stemming means "meetings" does not match
"meeting"; changing the configuration later is a migration that rebuilds one
generated column and its index.

---

## File Structure

**API — new files**
- `apps/api/src/meeting/pdf-text.ts` — the extraction port: the
  `PdfTextExtractor` type, the native implementation, and the
  layer-vs-OCR decision. No database, no HTTP.
- `apps/api/src/meeting/snippet.ts` — pure snippet builder. No database.
- `apps/api/src/meeting/indexing.ts` — the serial indexing queue and the
  job that writes `indexStatus` / `extractedText` / `indexedAt` /
  `indexError`. Owns all `trackBackgroundWork` registration.
- `apps/api/src/meeting/documents.ts` — the meeting-level document routes:
  list and retry. Registered like C's `registerActionUpdateRoutes`.

**API — modified**
- `apps/api/src/database/schema.ts` — `meetingDocumentTable` gains six
  columns, a generated `tsvector` and a GIN index.
- `apps/api/src/meeting/action-updates.ts` — presign and finalize accept
  `kind` and `originalObjectKey`; finalize enqueues indexing.
- `apps/api/src/meeting/index.ts` — register `registerMeetingDocumentRoutes`;
  extend the list route's `q` handling and its select.
- `apps/api/src/meeting/list-query.ts` — add `documentMatchCondition`.
- `apps/api/drizzle/0064_*.sql` — generated, then verified.
- `Dockerfile.kaneo`, `.github/workflows/ci.yml`, `CLAUDE.md`.

**Web — new files**
- `apps/web/src/components/general-management/meeting-documents.tsx` — the
  Overview tab's document list plus its upload control.

**Web — modified**
- `apps/web/src/fetchers/meeting/index.ts` — document fetchers.
- `apps/web/src/components/general-management/meeting-detail-dialog.tsx` —
  mount the document list in `OverviewSection`.
- `apps/web/src/components/general-management/minutes-manager.tsx` — show
  which document matched on a search hit.

**Tests**
- `tests/api/meeting-pdf-text.test.ts`, `tests/api/meeting-snippet.test.ts`
- `tests/api-integration/meeting-documents.test.ts`
- `tests/api-integration/meeting-document-search.test.ts`
- `apps/web/src/components/general-management/meeting-documents.test.tsx`

---

## Task 0: Reconcile with merged Spec C

**Files:** none changed unless drift is found.

- [ ] **Step 1: Confirm C is merged and read the shape this plan assumed**

```bash
git log --oneline -1 origin/main
git show origin/main:apps/api/src/database/schema.ts | sed -n '/meetingDocumentTable = pgTable/,/^);/p'
```

Expected: the table carries `id, meetingId, actionUpdateId, workspaceId,
objectKey (unique), filename, mimeType, size, sha256, kind (default
"original"), createdBy, createdAt` and two indexes.

- [ ] **Step 2: Confirm the four reused helpers still exist with these names**

```bash
git show origin/main:apps/api/src/meeting/action-updates.ts | grep -nE "assertCanAttachMeetingDocument|assertCanReadMeetingDocument|assertPdfOnly|MEETING_DOCUMENT_MIME_TYPE"
git show origin/main:apps/api/src/storage/s3.ts | grep -nE "createMeetingFileUploadUrl|getPrivateObject|buildMeetingFileObjectKey|meetingFileKeyOwnerSegment"
```

If any name has changed, record the new name and use it throughout; do not
rename anything back to match this plan.

- [ ] **Step 3: Confirm the one Spec-D-relevant fix from C's review is present**

C's final API review found that the document download gate resolved the
action update without scoping it to the meeting — latent in C, but live the
moment this plan adds a second writer to `meeting_document`. **It was fixed
before C merged** (commit `938f7bee`, with an integration test that returns
200 before the fix and 403 after). Confirm it is still there, since this
plan is what would make a regression exploitable:

```bash
git show origin/main:apps/api/src/meeting/action-updates.ts | sed -n '/attachments\/:docId\/download/,/^  );/p' | grep -c "meetingId"
```

Expected: at least one match inside the download handler. If it is zero,
STOP — do not build on top of it.

- [ ] **Step 4: Record findings in the ledger, then proceed**

If the table shape differs materially from Step 1's expectation, STOP and
escalate before Task 2.

---

## Task 1: Extraction binaries — probe, then wire into the image and CI

This task is first because R5's whole cost sits here, and because a failed
probe changes Task 3's implementation. Probe before writing code.

**Files:**
- Modify: `Dockerfile.kaneo`
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `pdftotext`, `pdftoppm` and `tesseract` on `PATH` in the
  production image and in CI. Task 3 depends on these three binary names.

- [ ] **Step 1: Probe that the Alpine packages resolve**

The runtime stage is Alpine (`apk add`, not `apt-get`). Verify against the
same base the Dockerfile uses — read the `FROM` line first, then:

```bash
grep -n "^FROM" Dockerfile.kaneo
docker run --rm node:22-alpine sh -c \
  'apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-msa \
   && pdftotext -v && pdftoppm -v && tesseract --version && tesseract --list-langs'
```

Expected: all four packages install; `tesseract --list-langs` lists `eng`
and `msa`.

**If `tesseract-ocr-data-msa` does not exist**, retry with `eng` only and
record it — OCR then runs `-l eng`, which still reads Malay text tolerably
because the script is Latin. **If `tesseract-ocr` itself does not resolve**,
STOP: R5's fallback applies and Task 3 needs re-planning.

- [ ] **Step 2: Add the packages to the runtime stage of the image**

Add to the **runtime** stage only (not the builder stages — they do not run
extraction and it would inflate build time for nothing), alongside the
existing nginx `apk add`:

```dockerfile
# Spec D: server-side PDF text extraction and OCR for archival meeting
# documents. poppler-utils gives pdftotext (text layer) and pdftoppm
# (rasterise for OCR); tesseract does the OCR. Language data is baked in
# rather than fetched at runtime so an offline container still works.
RUN apk add --no-cache \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      tesseract-ocr-data-msa
```

- [ ] **Step 3: Add the same packages to CI**

In `.github/workflows/ci.yml`, add a step to the job that runs the
integration suite, before the test step:

```yaml
      - name: Install PDF extraction tooling
        run: sudo apt-get update && sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-msa
```

CI runners are Ubuntu, so this one is `apt-get` — do not copy the Alpine
line here.

- [ ] **Step 4: Document the local-development requirement**

In `CLAUDE.md`, under **Important Notes**, add:

```markdown
- **PDF extraction binaries (Spec D)**: archival document indexing shells out
  to `pdftotext`, `pdftoppm` (poppler-utils) and `tesseract`. The production
  image and CI install them; for local work run
  `brew install poppler tesseract tesseract-lang`. Without them, indexing
  lands in `failed` with a "not installed" error and the ONE integration test
  that exercises the real binaries skips itself — the rest of the suite
  injects a fake extractor and passes regardless.
```

- [ ] **Step 5: Verify the image still builds**

```bash
docker build -f Dockerfile.kaneo -t kaneo:spec-d-probe . && \
docker run --rm --entrypoint sh kaneo:spec-d-probe -c \
  'pdftotext -v; pdftoppm -v; tesseract --list-langs'
```

Expected: build succeeds; all three respond; `eng` (and `msa`, if Step 1
found it) are listed.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.kaneo .github/workflows/ci.yml CLAUDE.md
git commit -m "chore(meeting): install PDF text extraction and OCR tooling"
```

---

## Task 2: Schema and migration

**Files:**
- Modify: `apps/api/src/database/schema.ts` (`meetingDocumentTable`)
- Create: `apps/api/drizzle/0064_*.sql` (generated)

**Interfaces:**
- Consumes: the table shape confirmed in Task 0.
- Produces: columns `originalObjectKey`, `indexStatus`, `indexedAt`,
  `indexError`, `extractedText`, and the generated `extractedTextSearch`.
  Every later task reads these exact names.

- [ ] **Step 1: Add the columns**

Replace the "Spec D extends this table" comment with the real columns.
Drizzle has no native `tsvector`, so declare a `customType` next to the
table:

```ts
// Postgres full-text search vector. Drizzle has no built-in tsvector, and a
// GENERATED column requires an IMMUTABLE expression — which rules out the
// one-argument `to_tsvector(text)` (it is only STABLE, since it reads
// `default_text_search_config`). Hence the explicit two-argument form.
// 'simple' rather than 'english': these documents mix Malay and English, and
// the English stemmer mangles Malay words. 'simple' lowercases and splits
// without stemming.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
```

and inside `meetingDocumentTable`, after `kind`:

```ts
    // The UNCOMPRESSED archival copy, when one exists separately. NULL means
    // `objectKey` IS the original — which is the common case, because
    // `compressPdfIfScanned` skips compression entirely for a PDF that
    // already has a text layer, so only scans ever produce two copies.
    // Minutes are legal records: a compression artefact that eats a
    // signature must never be the only surviving copy.
    originalObjectKey: text("original_object_key"),
    // pending | indexed | failed. Extraction is asynchronous, so a document
    // is invisible to search until it reaches `indexed` — the UI MUST say so
    // rather than letting a user conclude search is broken.
    indexStatus: text("index_status").notNull().default("pending"),
    indexedAt: timestamp("indexed_at", { mode: "date" }),
    indexError: text("index_error"),
    // The extracted text itself is stored alongside the vector because a
    // snippet needs the original characters; a tsvector cannot produce one.
    extractedText: text("extracted_text"),
    extractedTextSearch: tsvector("extracted_text_search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(extracted_text, ''))`,
    ),
```

and add to the index list:

```ts
    index("meeting_document_extractedTextSearch_idx").using(
      "gin",
      table.extractedTextSearch,
    ),
    index("meeting_document_indexStatus_idx").on(table.indexStatus),
```

Add `customType` and `sql` to the existing imports if absent.

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @kaneo/api db:generate
```

If drizzle-kit prompts for a rename, **answer "create column"** — there is no
rename in this task. If it prompts at all for these columns, stop and
re-read Step 1: a prompt means it thinks something is being renamed.

- [ ] **Step 3: Verify the generated SQL is additive and correct**

```bash
cat apps/api/drizzle/0064_*.sql
```

Expected: only `ALTER TABLE ... ADD COLUMN` and `CREATE INDEX` statements.
Confirm three things by eye:
1. No `DROP`, no `RENAME`, no `SET NOT NULL` on an existing column.
2. `extracted_text_search` is `GENERATED ALWAYS AS (to_tsvector('simple',
   coalesce(extracted_text, ''))) STORED` — with the **two-argument**
   `to_tsvector`. If drizzle emitted the one-argument form, the migration
   will fail at runtime with `generation expression is not immutable`; fix
   the schema expression and regenerate rather than hand-editing the SQL.
3. The GIN index is `USING gin ("extracted_text_search")`.

- [ ] **Step 4: Apply it against a scratch database and prove the DDL landed**

```bash
docker run -d --name kaneo-specd -e POSTGRES_PASSWORD=kaneo -e POSTGRES_USER=kaneo \
  -e POSTGRES_DB=kaneo -p 5471:5432 postgres:16-alpine
sleep 4
DATABASE_URL=postgres://kaneo:kaneo@127.0.0.1:5471/kaneo pnpm --filter @kaneo/api db:migrate
docker exec kaneo-specd psql -U kaneo -d kaneo -c '\d meeting_document'
```

Expected: all six new columns present, `extracted_text_search` shown as
generated, and both new indexes listed.

- [ ] **Step 5: Tear down the scratch database**

```bash
docker rm -f kaneo-specd
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/schema.ts apps/api/drizzle
git commit -m "feat(meeting): archival document indexing columns and FTS vector"
```

---

## Task 3: The extraction port and its native implementation

**Files:**
- Create: `apps/api/src/meeting/pdf-text.ts`
- Test: `tests/api/meeting-pdf-text.test.ts`

**Interfaces:**
- Consumes: `pdftotext`, `pdftoppm`, `tesseract` from Task 1.
- Produces:

```ts
export type ExtractionSource = "layer" | "ocr";
export type ExtractionResult = { text: string; source: ExtractionSource };
export type PdfTextExtractor = (pdf: Buffer) => Promise<ExtractionResult>;
export const MIN_MEANINGFUL_CHARS = 100;
export function isMeaningfulText(text: string): boolean;
export const extractPdfText: PdfTextExtractor;
```

Task 5 consumes `PdfTextExtractor` and `extractPdfText`; Task 5's tests
inject their own function of that type.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/api/meeting-pdf-text.test.ts`. Test the **decision**, which is
the spec's named unit target — not the binaries.

```ts
import { describe, expect, it } from "vitest";
import {
  MIN_MEANINGFUL_CHARS,
  isMeaningfulText,
} from "../../apps/api/src/meeting/pdf-text";

describe("isMeaningfulText — the OCR fallback decision", () => {
  it("rejects an empty text layer, which is what a scan yields", () => {
    expect(isMeaningfulText("")).toBe(false);
  });

  it("rejects whitespace-and-control-character noise", () => {
    expect(isMeaningfulText(" \n\t\f  \r\n ".repeat(40))).toBe(false);
  });

  it("rejects a short stray watermark below the threshold", () => {
    // A scan often carries a few characters from a stamp or watermark; that
    // is not a text layer worth preserving, and treating it as one would
    // skip OCR and leave the document effectively unsearchable.
    expect(isMeaningfulText("CONFIDENTIAL")).toBe(false);
  });

  it("accepts a real text layer at the threshold", () => {
    expect(isMeaningfulText("a".repeat(MIN_MEANINGFUL_CHARS))).toBe(true);
  });

  it("counts only non-whitespace toward the threshold", () => {
    // Exactly one char short once whitespace is discounted — so padding a
    // short layer with spaces must not buy its way past the gate.
    const padded = `${"a".repeat(MIN_MEANINGFUL_CHARS - 1)}${" ".repeat(500)}`;
    expect(isMeaningfulText(padded)).toBe(false);
  });

  it("uses the same threshold the client compressor uses", () => {
    // compress-pdf.ts's MIN_TEXT_CHARS is 100 and decides whether to
    // rasterise. If these two disagree, a PDF can be rasterised as "no text"
    // client-side and then judged "has text" server-side, or vice versa.
    expect(MIN_MEANINGFUL_CHARS).toBe(100);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @kaneo/api test -- meeting-pdf-text`
Expected: FAIL — cannot resolve `../../apps/api/src/meeting/pdf-text`.

- [ ] **Step 3: Implement**

Create `apps/api/src/meeting/pdf-text.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ExtractionSource = "layer" | "ocr";
export type ExtractionResult = { text: string; source: ExtractionSource };

/**
 * The seam. The native implementation below shells out to poppler and
 * tesseract; tests inject a fake so the integration suite does not need the
 * binaries installed. See R5 in the plan for why native rather than WASM.
 */
export type PdfTextExtractor = (pdf: Buffer) => Promise<ExtractionResult>;

/**
 * Deliberately the same value as `MIN_TEXT_CHARS` in
 * `apps/web/src/lib/compress-pdf.ts`. The client uses it to decide whether
 * to rasterise; we use it to decide whether to OCR. If they diverge, a file
 * can be rasterised as "no text" and then judged "has text" here, which
 * leaves it unsearchable with nothing to explain why.
 */
export const MIN_MEANINGFUL_CHARS = 100;

/** OCR languages. Latin-script Malay reads tolerably under `eng` alone, so a
 * missing `msa` data package degrades accuracy rather than breaking OCR. */
const OCR_LANGS = "eng+msa";
const OCR_DPI = "200";

export function isMeaningfulText(text: string): boolean {
  // Count only non-whitespace: a handful of characters padded with newlines
  // is a watermark, not a text layer. \s misses NUL and the other C0
  // controls that broken producers emit, so strip those too.
  const dense = text.replace(/[\s\u0000-\u001f]/g, "");
  return dense.length >= MIN_MEANINGFUL_CHARS;
}

async function pdfToText(path: string): Promise<string> {
  // `-layout` preserves reading order across columns, which matters for
  // minutes laid out as tables. `-` writes to stdout.
  const { stdout } = await run("pdftotext", ["-layout", path, "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function ocr(dir: string, path: string): Promise<string> {
  // Rasterise first: tesseract cannot read PDFs directly. pdftoppm writes
  // <prefix>-1.png, <prefix>-2.png, …
  await run("pdftoppm", ["-r", OCR_DPI, "-png", path, join(dir, "page")], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const pages = (await readdir(dir))
    .filter((f) => f.startsWith("page") && f.endsWith(".png"))
    // Numeric sort: lexicographic puts page-10 before page-2, which would
    // scramble the reading order of anything over nine pages.
    .sort((a, b) => {
      const n = (s: string) => Number(s.match(/-(\d+)\.png$/)?.[1] ?? 0);
      return n(a) - n(b);
    });

  const out: string[] = [];
  for (const page of pages) {
    // Serial, not Promise.all: this box has 2 vCPU and also runs Postgres,
    // MinIO and the app. See the spec's OCR section.
    const { stdout } = await run(
      "tesseract",
      [join(dir, page), "-", "-l", OCR_LANGS],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    out.push(stdout);
  }
  return out.join("\n\n");
}

/**
 * Text layer first, OCR only when it yields nothing meaningful — archival
 * scans usually have no text layer, which is the whole reason OCR is here.
 *
 * Every argument goes through `execFile`'s array form: the filename is
 * attacker-controlled, and a template-string command would be a shell
 * injection. The PDF is written to a private mkdtemp directory, and that
 * directory is always removed, including on failure.
 */
export const extractPdfText: PdfTextExtractor = async (pdf) => {
  const dir = await mkdtemp(join(tmpdir(), "kaneo-pdf-"));
  const path = join(dir, "input.pdf");
  try {
    await writeFile(path, pdf);
    const layer = await pdfToText(path);
    if (isMeaningfulText(layer)) return { text: layer, source: "layer" };
    return { text: await ocr(dir, path), source: "ocr" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kaneo/api test -- meeting-pdf-text`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the native path actually works on a real PDF**

A unit test cannot cover this, and "the tests pass" is not evidence the
binaries produce text. Write this as a temporary vitest file under the
scratchpad, run it, read the output, then delete it:

```ts
import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, it } from "vitest";
import { extractPdfText } from "../../apps/api/src/meeting/pdf-text";

it("reads the text layer of a generated PDF", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage()
    .drawText(
      "Mesyuarat Jawatankuasa Wisma MAPIM Malaysia bilangan satu. ".repeat(4),
      { x: 20, y: 700, size: 11, font, maxWidth: 540 },
    );
  const result = await extractPdfText(Buffer.from(await doc.save()));
  console.log("source:", result.source, "chars:", result.text.trim().length);
  expect(result.source).toBe("layer");
  expect(result.text).toContain("Jawatankuasa");
});
```

Expected: passes, logging `source: layer`. If it logs `source: ocr`, the
text layer was not read — investigate before proceeding, or every digital
PDF will be sent through OCR needlessly.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/meeting/pdf-text.ts tests/api/meeting-pdf-text.test.ts
git commit -m "feat(meeting): PDF text extraction with OCR fallback"
```

---

## Task 4: The snippet builder

**Files:**
- Create: `apps/api/src/meeting/snippet.ts`
- Test: `tests/api/meeting-snippet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function buildSnippet(text: string, term: string, radius?: number): string | null`
  — Task 8 calls it per matched document.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildSnippet } from "../../apps/api/src/meeting/snippet";

describe("buildSnippet", () => {
  it("centres the window on the match and ellipsises both sides", () => {
    const text = `${"a".repeat(200)} quorum ${"b".repeat(200)}`;
    const s = buildSnippet(text, "quorum", 20) as string;
    expect(s).toContain("quorum");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });

  it("does not ellipsise a side it did not truncate", () => {
    const s = buildSnippet("quorum was reached", "quorum", 40) as string;
    expect(s).toBe("quorum was reached");
  });

  it("matches case-insensitively but returns the original casing", () => {
    const s = buildSnippet("The QUORUM was reached", "quorum", 40) as string;
    expect(s).toContain("QUORUM");
  });

  it("returns null when the term is absent, so the caller can omit the hit", () => {
    expect(buildSnippet("nothing relevant here", "quorum", 40)).toBeNull();
  });

  it("treats regex metacharacters in the term as literals", () => {
    // A term of "." must not match the first character of everything.
    expect(buildSnippet("abc", ".", 10)).toBeNull();
    expect(buildSnippet("a.c", ".", 10)).toBe("a.c");
  });

  it("collapses newlines so a snippet stays one line in the UI", () => {
    const s = buildSnippet("minutes\n\n\tquorum\nreached", "quorum", 40) as string;
    expect(s).not.toMatch(/[\n\t]/);
  });

  it("never returns more than the window plus the term", () => {
    const text = "x".repeat(5000);
    const s = buildSnippet(`${text}quorum${text}`, "quorum", 30) as string;
    // 30 either side + the term + two ellipses.
    expect(s.length).toBeLessThanOrEqual(30 * 2 + "quorum".length + 2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kaneo/api test -- meeting-snippet`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/** Half-width of the window around the match, in characters. */
const DEFAULT_RADIUS = 90;

/**
 * A short, single-line excerpt around the first occurrence of `term`, so a
 * search result can explain itself. Returns null when the term is absent —
 * the caller omits that document from the hit rather than showing an
 * unexplained match.
 *
 * A snippet is CONTENT. Callers must already have established that the
 * viewer may read the meeting this text came from; see the spec's
 * confidentiality section.
 */
export function buildSnippet(
  text: string,
  term: string,
  radius: number = DEFAULT_RADIUS,
): string | null {
  const needle = term.trim();
  if (!needle) return null;

  // Plain indexOf on lowercased copies: no regex, so metacharacters in the
  // term are literals and there is no catastrophic-backtracking surface on
  // user input. Both strings are lowercased with the same rules, so the
  // index maps back to the original text 1:1 for the alphabets in use.
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @kaneo/api test -- meeting-snippet`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/meeting/snippet.ts tests/api/meeting-snippet.test.ts
git commit -m "feat(meeting): search snippet builder"
```

---

## Task 5: The serial indexing queue

**Files:**
- Create: `apps/api/src/meeting/indexing.ts`
- Test: covered by Task 7's integration tests (this task's correctness is
  observable only through the database).

**Interfaces:**
- Consumes: `PdfTextExtractor`, `extractPdfText` (Task 3); `getPrivateObject`
  (`storage/s3.ts`); `trackBackgroundWork` (`utils/background-work.ts`); the
  Task 2 columns.
- Produces:

```ts
export function setPdfTextExtractor(next: PdfTextExtractor): void;
export function resetPdfTextExtractor(): void;
export function enqueueDocumentIndexing(documentId: string): void;
export async function indexDocumentNow(documentId: string): Promise<void>;
```

Task 6 calls `enqueueDocumentIndexing` from finalize; Task 7's retry route
calls it too; Task 7's tests call `setPdfTextExtractor`.

- [ ] **Step 1: Implement**

```ts
import { eq } from "drizzle-orm";
import db from "../database";
import { meetingDocumentTable } from "../database/schema";
import { getPrivateObject } from "../storage/s3";
import { trackBackgroundWork } from "../utils/background-work";
import { type PdfTextExtractor, extractPdfText } from "./pdf-text";

/**
 * Swappable so the integration suite does not need poppler and tesseract
 * installed. Production never calls the setter.
 */
let extractor: PdfTextExtractor = extractPdfText;

export function setPdfTextExtractor(next: PdfTextExtractor): void {
  extractor = next;
}

export function resetPdfTextExtractor(): void {
  extractor = extractPdfText;
}

/**
 * A single promise chain, process-wide. OCR is CPU-heavy and this box has 2
 * vCPU shared with Postgres, MinIO and the app, so documents are indexed
 * strictly one at a time (the spec is explicit about this). Each job is
 * appended to the tail rather than started immediately.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Pull the PDF back out of storage and index it.
 *
 * Reads `originalObjectKey ?? objectKey` — the ORIGINAL, never the served
 * copy. `compressPdfIfScanned` only rasterises PDFs that have no text layer,
 * so a compressed copy never holds text worth extracting, and for a scan the
 * original is the better OCR input. (R2.)
 */
export async function indexDocumentNow(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      id: meetingDocumentTable.id,
      objectKey: meetingDocumentTable.objectKey,
      originalObjectKey: meetingDocumentTable.originalObjectKey,
    })
    .from(meetingDocumentTable)
    .where(eq(meetingDocumentTable.id, documentId))
    .limit(1);

  // Deleted between enqueue and execution: nothing to do, and not an error.
  if (!doc) return;

  try {
    const object = await getPrivateObject(
      doc.originalObjectKey ?? doc.objectKey,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    const { text } = await extractor(Buffer.concat(chunks));

    await db
      .update(meetingDocumentTable)
      .set({
        // Store the text as well as the vector: a snippet needs the original
        // characters, which a tsvector cannot reproduce. The vector column
        // is GENERATED, so it updates itself from this write.
        extractedText: text,
        indexStatus: "indexed",
        indexedAt: new Date(),
        indexError: null,
      })
      .where(eq(meetingDocumentTable.id, documentId));
  } catch (error) {
    // A failed index must be VISIBLE and RETRYABLE, never silent. Truncate:
    // a tesseract or poppler failure can emit a great deal of stderr, and
    // this string is shown in the UI.
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    await db
      .update(meetingDocumentTable)
      .set({
        indexStatus: "failed",
        indexError: message.slice(0, 500),
        indexedAt: null,
      })
      .where(eq(meetingDocumentTable.id, documentId));
  }
}

/**
 * Append an indexing job to the serial queue and register it with
 * `trackBackgroundWork`.
 *
 * The registration is not optional: this promise runs DB writes after its
 * request has already responded, and untracked work of exactly this shape
 * has deadlocked the integration harness twice by racing an in-flight
 * UPDATE against the between-test TRUNCATE. Tests await
 * `settleBackgroundWork()`.
 *
 * `.catch` on the tail keeps one failed document from poisoning the queue
 * for every document behind it — `indexDocumentNow` already records its own
 * failure in the row.
 */
export function enqueueDocumentIndexing(documentId: string): void {
  queue = queue.then(() => indexDocumentNow(documentId)).catch(() => {});
  trackBackgroundWork(queue);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kaneo/api exec tsc --noEmit`
Expected: exit 0. If `object.body` does not satisfy `AsyncIterable`, check
`AssetObject`'s declared body type in `storage/s3.ts` and adapt — do not
cast through `any`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/meeting/indexing.ts
git commit -m "feat(meeting): serial document indexing queue"
```

---

## Task 6: Accept `kind` and `originalObjectKey`, and enqueue indexing

**Files:**
- Modify: `apps/api/src/meeting/action-updates.ts` (presign and finalize)

**Interfaces:**
- Consumes: `enqueueDocumentIndexing` (Task 5); the existing
  `assertCanAttachMeetingDocument`, `assertPdfOnly`, `applyKeyPrefix`,
  `assertStorageConfigured`, `meetingFileKeyOwnerSegment`.
- Produces: finalize accepts `kind` and `originalObjectKey` and enqueues
  indexing. Task 9's uploader depends on this request shape.

- [ ] **Step 1: Add the `kind` picklist next to the existing validators**

```ts
/**
 * R1: Spec C shipped `kind` defaulting to "original" and never wrote it, so
 * every existing row reads "original" — that stays the reply-attachment
 * value. A meeting-level archival document must declare what it is.
 * Nothing in the database enforces this, so the API layer must.
 */
const meetingDocumentKind = v.picklist(["transcript", "minutes", "other"]);
```

- [ ] **Step 2: Extend the finalize schema**

Add to finalize's `validator("json", v.object({ … }))`:

```ts
        // Present only for a meeting-level archival document; a reply
        // attachment keeps the "original" default.
        kind: v.optional(meetingDocumentKind),
        // The uncompressed copy, when the client actually compressed. NULL
        // means objectKey IS the original — see R3.
        originalObjectKey: v.optional(v.string()),
```

- [ ] **Step 3: Validate the second key through the SAME owner-segment guard**

`originalObjectKey` is a second client-supplied storage key and must not be
trusted any less than `objectKey`. Immediately after the existing
`objectKey` check, and reusing the same `ownerSegmentPrefix`:

```ts
      // Identical guard to objectKey's above. A second key is a second
      // chance to claim someone else's uploaded object, so it gets the same
      // `startsWith` (not `includes`) rooting check and the same `..`
      // rejection.
      if (
        b.originalObjectKey &&
        (b.originalObjectKey.includes("..") ||
          !b.originalObjectKey.startsWith(ownerSegmentPrefix))
      )
        throw new HTTPException(400, { message: "Invalid object key" });
```

- [ ] **Step 4: Write the new columns and enqueue indexing**

In finalize's insert `.values({ … })`, add:

```ts
          kind: b.kind ?? "original",
          originalObjectKey: b.originalObjectKey ?? null,
```

and after the insert, before the response:

```ts
      // Meeting-level archival documents get indexed for search. A reply
      // attachment does not: the spec's search covers the archive, and
      // indexing every thread attachment would spend OCR minutes on a
      // 2-vCPU box for text nothing queries.
      if (!b.actionUpdateId && row) enqueueDocumentIndexing(row.id);
```

- [ ] **Step 5: Confirm neither storage key is returned**

```bash
grep -n "originalObjectKey" apps/api/src/meeting/*.ts
```

Expected: the validator, the guard, the insert, and `indexing.ts`'s internal
select. It must NOT appear in any `c.json(...)` projection. Note finalize
currently returns `row` from `.returning()`, which includes both keys —
**narrow that projection now**:

```ts
      return c.json(
        {
          id: row.id,
          meetingId: row.meetingId,
          actionUpdateId: row.actionUpdateId,
          filename: row.filename,
          mimeType: row.mimeType,
          size: row.size,
          kind: row.kind,
          indexStatus: row.indexStatus,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        },
        201,
      );
```

If Spec C's final review already narrowed this, extend the existing
projection with `kind` and `indexStatus` rather than replacing it.

- [ ] **Step 6: Typecheck and run C's attachment tests**

Run: `pnpm --filter @kaneo/api exec tsc --noEmit`
Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-action-updates`
Expected: exit 0, and C's attachment tests still pass — this task must not
change reply-attachment behaviour. If a C test asserted the full row shape,
Step 5 legitimately changed it; update that assertion and say so in the
commit body.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/meeting/action-updates.ts
git commit -m "feat(meeting): accept document kind and original key, enqueue indexing"
```

---

## Task 7: Meeting document list and retry routes

**Files:**
- Create: `apps/api/src/meeting/documents.ts`
- Modify: `apps/api/src/meeting/index.ts` (register)
- Test: `tests/api-integration/meeting-documents.test.ts`

**Interfaces:**
- Consumes: `assertCanReadMeeting`, `loadMeeting`,
  `assertCanAttachMeetingDocument` (from `action-updates.ts` — export them if
  they are module-private), `enqueueDocumentIndexing`,
  `setPdfTextExtractor` / `resetPdfTextExtractor` (tests only).
- Produces: `registerMeetingDocumentRoutes(app: Hono<MeetingEnv>)`;
  `GET /:id/documents`; `POST /:id/documents/:docId/reindex`.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/api-integration/meeting-documents.test.ts`. Inject a fake
extractor so the suite needs no binaries:

```ts
setPdfTextExtractor(async () => ({ text: FIXTURE_TEXT, source: "layer" }));
```

with `afterEach(resetPdfTextExtractor)`. Write these cases:

1. `a document begins pending and reaches indexed` — finalize a
   meeting-level document, assert `indexStatus === "pending"` in the
   response, `await settleBackgroundWork()`, then assert the row is
   `indexed`, `indexedAt` is set, `indexError` is null and `extractedText`
   matches the fake's output. **No sleep.**
2. `a failed extraction lands in failed with an error, and is retryable` —
   inject an extractor that throws, settle, assert `failed` + `indexError`
   non-null, then `POST …/reindex` with a working extractor, settle, and
   assert `indexed` with `indexError` back to null.
3. `reindex refuses a caller who may not attach to the meeting` — assert 403
   **and** that `indexStatus` did not change.
4. `the list route returns each of several documents` — finalize three,
   assert all three come back with their `kind` and `indexStatus`.
5. `the list route never returns a storage key` — assert
   `JSON.stringify(body)` contains neither `"objectKey"` nor
   `"original_object_key"` nor the literal key string.
6. `a non-attendee cannot list a confidential meeting's documents` — assert
   403/404, and that the body contains neither the meeting title nor any
   filename.
7. `a non-PDF is refused at presign as well as finalize` — two assertions,
   both 400. If Spec C already covers this, reference its test by name
   rather than duplicating, and say so in the file.
8. `the real extractor reads a generated PDF` — build a PDF with `pdf-lib`,
   run the real `extractPdfText`, assert `source === "layer"`. Guard with a
   probe that `pdftotext` exists and `it.skip` when it does not.

**For each test, check it would fail if the behaviour were removed.** This
branch's predecessor repeatedly produced tests that passed with the check
deleted: an unauthorised subject that would have failed anyway, an ordering
test that passed on a timestamp tie, an assertion on a field the route never
touched. Specifically: in case 3 the `indexStatus` non-change assertion is
what makes it bite; in case 6 use a word that exists **only** in the
confidential document.

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-documents`
Expected: FAIL — the routes do not exist (404s).

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/meeting/documents.ts` following
`action-updates.ts`'s `registerActionUpdateRoutes` shape exactly — same
`describeRoute` + `validator` + `workspaceAccess.fromQuery` ordering.

`GET /:id/documents` — `validator("query", v.object({ workspaceId: v.string() }))`,
then `loadMeeting`, 404 if absent, `assertCanReadMeeting`, then:

```ts
      const docs = await db
        .select({
          id: meetingDocumentTable.id,
          filename: meetingDocumentTable.filename,
          size: meetingDocumentTable.size,
          kind: meetingDocumentTable.kind,
          indexStatus: meetingDocumentTable.indexStatus,
          indexedAt: meetingDocumentTable.indexedAt,
          indexError: meetingDocumentTable.indexError,
          createdBy: meetingDocumentTable.createdBy,
          createdAt: meetingDocumentTable.createdAt,
          // objectKey and originalObjectKey are deliberately absent: they
          // are internal storage detail, and the download route is the only
          // way to reach the bytes.
        })
        .from(meetingDocumentTable)
        .where(
          and(
            eq(meetingDocumentTable.meetingId, id),
            // Archival documents only. Reply attachments belong to the
            // action thread and are returned by the updates route.
            isNull(meetingDocumentTable.actionUpdateId),
          ),
        )
        .orderBy(desc(meetingDocumentTable.createdAt));
      return c.json(docs);
```

`POST /:id/documents/:docId/reindex` — same param/query validators plus
`docId`; `loadMeeting`; 404; then **the upload gate, not the read gate** —
re-indexing spends CPU, so it takes the same permission as uploading:

```ts
      await assertCanAttachMeetingDocument(
        userId,
        ws,
        meeting,
        null,
        MEETING_DOCUMENT_MIME_TYPE,
      );
```

then load the row scoped by `meetingId` (404 if absent — never trust `docId`
alone), set it back to `pending` with `indexError: null`, call
`enqueueDocumentIndexing(docId)` and return the new state.

- [ ] **Step 4: Register the routes**

In `apps/api/src/meeting/index.ts`, beside the existing registrations:

```ts
// Registered alongside the other "/:id/..." registrars for the same reason
// the memo routes are: Hono matches literal segments before params, so
// "/:id/documents" is not swallowed by "/:id".
registerMeetingDocumentRoutes(app);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-documents`
Expected: PASS (case 8 may report as skipped without the binaries).

- [ ] **Step 6: Prove two of the tests bite**

Not optional — this is the check the predecessor branch kept skipping.
Temporarily break the code, confirm the test fails, then restore:

```bash
cp apps/api/src/meeting/documents.ts /tmp/documents.ts.bak
# 1. strip the confidentiality gate; case 6 MUST fail
# 2. restore, then strip the isNull(actionUpdateId) filter; case 4 or 5 MUST fail
cp /tmp/documents.ts.bak apps/api/src/meeting/documents.ts && rm /tmp/documents.ts.bak
git diff --exit-code apps/api/src/meeting/documents.ts
```

**Restore before doing anything else, and confirm `git diff --exit-code`
prints nothing.** A previous run of this exercise timed out before its
restore step and left a guard stripped in the working tree.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/meeting/documents.ts apps/api/src/meeting/index.ts tests/api-integration/meeting-documents.test.ts
git commit -m "feat(meeting): archival document list and reindex routes"
```

---

## Task 8: Extend `q` to match document text

The highest-risk task in the plan. A snippet is content, and this is a
brand-new way to leak a confidential meeting.

**Files:**
- Modify: `apps/api/src/meeting/list-query.ts` (add `documentMatchCondition`)
- Modify: `apps/api/src/meeting/index.ts` (the list route)
- Test: `tests/api-integration/meeting-document-search.test.ts`

**Interfaces:**
- Consumes: `visibilityCondition`, `escapeLikePattern`, `keysetCondition`
  (existing); `buildSnippet` (Task 4).
- Produces: `documentMatchCondition(term: string): SQL`; the list route's
  rows gain `matchedDocuments: MatchedDocument[]`.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/api-integration/meeting-document-search.test.ts`:

1. `a word that exists only inside a PDF finds the meeting` — index a
   document whose text contains `ZARZUELA` (a token in no title, location,
   type or body), search `q=ZARZUELA`, assert the meeting is returned and
   `matchedDocuments[0].snippet` contains the word.
2. **`a non-attendee searching a word unique to a confidential meeting's PDF
   gets nothing`** — the spec's central test. Assert the meeting is absent
   **and** that the raw response body contains neither the unique word nor
   the document's filename nor the meeting's title. Then assert an attendee
   *does* get it, and that a global admin does too.
3. `an unindexed document is not searchable` — finalize without settling,
   search, assert no hit; then settle and assert the hit appears. This is
   what makes the "Indexing…" UI honest.
4. `search still paginates correctly when documents match` — create
   `limit + 3` meetings that each match only through their document, page
   through with the cursor, and assert every meeting is seen exactly once
   and none is skipped. Give the fixtures **distinct** `scheduledAt` values:
   an ordering assertion over ties passes by luck.
5. `a meeting with several matching documents returns each in matchedDocuments`
   — three documents, one hit, `matchedDocuments.length === 3` (R4).
6. `a metadata match still works and reports no matched documents` — guards
   against the document condition breaking title search.

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-document-search`
Expected: FAIL — searches by document text return nothing.

- [ ] **Step 3: Add the match condition**

In `list-query.ts`:

```ts
/**
 * "This meeting has an indexed archival document whose text matches."
 *
 * An EXISTS subquery, deliberately, rather than a join: the list route's
 * `limit + 1` page detection and its keyset cursor are both meeting-keyed,
 * so a join that multiplied rows per matching document would corrupt
 * pagination — the exact class of bug that took three rounds to get right
 * here. See R4.
 *
 * Correlated on `meetingTable.id`, so it composes inside the route's
 * existing `or(...)` and is applied in the SAME query as
 * `visibilityCondition` — never as a post-filter, which would mean reading
 * confidential snippets into memory before discarding them.
 */
export function documentMatchCondition(term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  return exists(
    db
      .select({ one: sql`1` })
      .from(meetingDocumentTable)
      .where(
        and(
          eq(meetingDocumentTable.meetingId, meetingTable.id),
          // Archival documents only, and only once indexed: a `pending` row
          // has no text, and a `failed` one never will until retried.
          isNull(meetingDocumentTable.actionUpdateId),
          eq(meetingDocumentTable.indexStatus, "indexed"),
          ilike(meetingDocumentTable.extractedText, pattern),
        ),
      ),
  );
}
```

**On `ilike` vs the `tsvector`:** the generated column and its GIN index
exist for scale, but `ilike` is what makes this behave like the rest of `q`
(which is `ilike` on title, location, type and body) and what lets
`buildSnippet` find the same term that matched. Keep both: the vector is
there for a later switch to `@@ websearch_to_tsquery` once corpus size
justifies it, and the index costs nothing until then. Say this in the commit
body; **do not delete the vector.**

- [ ] **Step 4: Wire it into the list route's `or(...)`**

```ts
        or(
          ilike(meetingTable.title, pattern),
          ilike(meetingTable.location, pattern),
          ilike(meetingTypeTable.label, pattern),
          ilike(meetingBodyTable.name, pattern),
          documentMatchCondition(term),
        ) as SQL,
```

- [ ] **Step 5: Attach snippets to the page's rows**

**After** the page has been sliced to `limit` rows — never before, or you
fetch text for a row you are about to discard. One `inArray` query over the
already-authorised meeting ids:

```ts
    type MatchedDocument = {
      id: string;
      filename: string;
      kind: string;
      snippet: string;
    };

    // Snippets for the page's meetings only. These ids have already passed
    // `visibilityCondition` in the query above, so fetching their document
    // text here discloses nothing new — but the ORDER of these two steps is
    // load-bearing, so do not hoist this.
    let matched = new Map<string, MatchedDocument[]>();
    if (term && page.length > 0) {
      const rows = await db
        .select({
          id: meetingDocumentTable.id,
          meetingId: meetingDocumentTable.meetingId,
          filename: meetingDocumentTable.filename,
          kind: meetingDocumentTable.kind,
          extractedText: meetingDocumentTable.extractedText,
        })
        .from(meetingDocumentTable)
        .where(
          and(
            inArray(
              meetingDocumentTable.meetingId,
              page.map((r) => r.id),
            ),
            isNull(meetingDocumentTable.actionUpdateId),
            eq(meetingDocumentTable.indexStatus, "indexed"),
            ilike(meetingDocumentTable.extractedText, pattern),
          ),
        );
      matched = rows.reduce((acc, r) => {
        const snippet = buildSnippet(r.extractedText ?? "", term);
        // Null means the term is not actually in the text — should not
        // happen given the ilike above, but omit rather than show an empty
        // snippet.
        if (!snippet) return acc;
        const list = acc.get(r.meetingId) ?? [];
        list.push({ id: r.id, filename: r.filename, kind: r.kind, snippet });
        acc.set(r.meetingId, list);
        return acc;
      }, new Map<string, MatchedDocument[]>());
    }
```

Then add `matchedDocuments: matched.get(row.id) ?? []` to each returned row,
and export `MatchedDocument` for the web fetcher.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-document-search`
Expected: PASS, 6 tests.

- [ ] **Step 7: Prove the confidentiality test bites**

```bash
cp apps/api/src/meeting/index.ts /tmp/idx.bak
# Remove the `conditions.push(visibility)` line — test 2 MUST fail on the
# unique-word assertion, not merely on a card count.
cp /tmp/idx.bak apps/api/src/meeting/index.ts && rm /tmp/idx.bak
git diff --exit-code apps/api/src/meeting/index.ts
```

Restore immediately and confirm `git diff --exit-code` is silent.

- [ ] **Step 8: Also run the Spec A pagination suite**

Run: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration -- meeting-list`
Expected: PASS unchanged. This task edits the query that suite guards, and a
regression here is a pagination bug — the one class that hides.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/meeting/list-query.ts apps/api/src/meeting/index.ts tests/api-integration/meeting-document-search.test.ts
git commit -m "feat(meeting): search archival document text within the q parameter"
```

---

## Task 9: Overview tab — the document list and uploader

**Files:**
- Create: `apps/web/src/components/general-management/meeting-documents.tsx`
- Modify: `apps/web/src/fetchers/meeting/index.ts`
- Modify: `apps/web/src/components/general-management/meeting-detail-dialog.tsx`
- Test: `apps/web/src/components/general-management/meeting-documents.test.tsx`

**Interfaces:**
- Consumes: `GET /:id/documents`, `POST /:id/documents/:docId/reindex`, and
  C's presign/finalize/download at Task 6's extended shape.
- Produces: `<MeetingDocuments meetingId workspaceId canUpload />`, mounted
  in `OverviewSection`.

- [ ] **Step 1: Add the fetchers**

In `apps/web/src/fetchers/meeting/index.ts` add
`MeetingArchivalDocument` (`id, filename, size, kind, indexStatus,
indexedAt, indexError, createdBy, createdAt` — no storage keys),
`listMeetingDocuments`, `reindexMeetingDocument`, and extend the uploader:

```ts
/**
 * Compress, then upload one or two copies.
 *
 * `compressPdfIfScanned` SKIPS a PDF that already has a text layer, so a
 * digital PDF yields one copy and `originalObjectKey` stays undefined; only
 * a scan produces two. See R3 — this is why the server treats a null
 * original as "objectKey is the original" rather than requiring both.
 */
export async function uploadArchivalMeetingDocument(
  workspaceId: string,
  meetingId: string,
  file: File,
  kind: "transcript" | "minutes" | "other",
  engine?: PdfEngine,
): Promise<MeetingArchivalDocument> {
  const result = await compressPdfIfScanned(file, { engine });
  const served = await putOne(workspaceId, meetingId, result.file);
  // Only upload a second copy when compression actually changed the bytes.
  const original =
    result.skipped === null
      ? await putOne(workspaceId, meetingId, file)
      : null;
  return finalizeMeetingDocument(workspaceId, meetingId, {
    objectKey: served.key,
    originalObjectKey: original?.key,
    filename: file.name,
    mimeType: "application/pdf",
    size: result.file.size,
    kind,
  });
}
```

where `putOne` is the existing presign-then-PUT pair extracted as a helper.

- [ ] **Step 2: Write the failing component tests**

```tsx
describe("MeetingDocuments", () => {
  it("lists each document with its kind and size", async () => { /* … */ });

  it("says Indexing… while a document is pending, so search looking empty is explained", async () => {
    // The spec is explicit: a pending document is invisible to search, and
    // if the UI does not say so the user concludes search is broken.
  });

  it("shows a failed index with its error and a Retry control", async () => { /* … */ });

  it("distinguishes a failed LIST from an empty one", async () => {
    // This module shipped a bug where an errored query rendered exactly like
    // an empty one. Assert the error text appears and the empty-state copy
    // does NOT.
  });

  it("rejects a non-PDF before any upload request is made", async () => {
    // Assert on the fetch spy: zero calls. Asserting only on the toast would
    // pass even if the request went out anyway.
  });

  it("disables the upload control while an upload is in flight", async () => {
    // If the target is a Base UI control rather than a native <button>,
    // assert aria-disabled="true" — jest-dom's toBeDisabled() gives a FALSE
    // NEGATIVE against Base UI's <span role="checkbox">.
  });

  it("surfaces a failed finalize after a successful PUT", async () => {
    // The seam that loses a file silently: storage accepted the bytes, the
    // row was never written. The user must be told.
  });

  it("invalidates the document list after a successful upload", async () => { /* … */ });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @kaneo/web test -- meeting-documents`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement the component**

A `useQuery` on `["meeting-documents", meetingId]`; a `useMutation` each for
upload and retry, both invalidating that key on success **and both carrying
an `onError` that toasts**. C's final review found the one mutation missing
`onError` failed completely silently — do not repeat it here. Render, per
row: `kind`, filename, formatted size, uploader, and an indexing badge —
`Indexing…` for `pending`, nothing extra for `indexed`, and for `failed` the
truncated `indexError` plus a Retry button. Distinguish the query's
`isError` from an empty list explicitly. Call `isPdfUpload(file)` before
touching the network, and keep `usePdfCompression`'s progress visible during
compression. **Do not clear the picked file until the upload has succeeded**
— C's review found the mirror of this bug in the action thread, where a
failed upload discarded the file with no way to retry.

- [ ] **Step 5: Mount it in the Overview tab**

`OverviewSection` already takes `meeting: MeetingDetail`; add the component
at the end of its `space-y-5` stack. It needs `workspaceId` — thread it from
the dialog's existing props rather than reading a store inside the list.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @kaneo/web test -- meeting-documents`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(meeting): archival documents in the meeting Overview tab"
```

---

## Task 10: Show which document matched on a search hit

**Files:**
- Modify: `apps/web/src/components/general-management/minutes-manager.tsx`
- Modify: `apps/web/src/fetchers/meeting/index.ts` (`matchedDocuments` on the
  list row type)
- Test: extend the existing minutes-manager test file.

- [ ] **Step 1: Write the failing tests**

1. `a hit that matched inside a PDF shows the filename and the snippet`
2. `a hit that matched on metadata shows no document line` — so the snippet
   block does not appear on every card.
3. `the grid says results may be incomplete while any document is indexing`
   — the spec requires this said plainly in the search UI, not only per row.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kaneo/web test -- minutes-manager`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

Add `matchedDocuments` to the list row type. When the array is non-empty,
render each entry as one muted line: the filename, then the snippet. Render
the snippet as **text** — never `dangerouslySetInnerHTML`; it is document
content and the server does not escape it for HTML.

For case 3, surface the incomplete-results notice when any card carries a
`pending` document. If the list route does not expose that, add a
`pendingIndexCount` to its response rather than issuing a second query per
card.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kaneo/web test -- minutes-manager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(meeting): show the matched document and snippet on a search hit"
```

---

## Task 11: Whole-feature verification

**Files:** none — this task only runs things and reports.

- [ ] **Step 1: Typecheck, lint, build**

```bash
pnpm typecheck; echo "typecheck: $?"
pnpm biome ci .; echo "biome: $?"
pnpm build; echo "build: $?"
```

All three must exit 0. Note `biome ci .` over the whole repo catches what
`biome check <files>` on a subset does not.

- [ ] **Step 2: Every suite**

```bash
pnpm --filter @kaneo/api test
pnpm --filter @kaneo/web test
DATABASE_URL=… pnpm --filter @kaneo/api test:integration
```

Run the integration suite **alone** (not through the root `pnpm test`), per
CLAUDE.md — turbo drops a `DATABASE_URL` override and the suite silently
falls back to port 5432. Record the counts.

- [ ] **Step 3: Confirm the migration is additive**

```bash
cat apps/api/drizzle/0064_*.sql
```

Assert by eye: no `DROP`, no `RENAME`, no `SET NOT NULL` on a pre-existing
column. If any appears, the release becomes a **major** and CLAUDE.md's
rollback section needs a new entry — escalate rather than deciding alone.

- [ ] **Step 4: Confirm no storage key reaches any response**

```bash
grep -rn "objectKey\|originalObjectKey" apps/api/src/meeting/ | grep -v "\.test\."
```

Every hit must be a validator, a guard, an insert, or an internal select —
never inside a `c.json(...)` projection.

- [ ] **Step 5: Confirm the other two "minutes" were not touched**

```bash
git diff --stat $(git merge-base main HEAD)..HEAD -- '*task_mom*' '*letter_minute*' '*project-minutes*'
```

Expected: empty output.

- [ ] **Step 6: Render a real search, end to end**

Tests passing is not evidence a user can find a document. Start the stack,
upload a real scanned PDF through the UI, wait for `indexed`, search a word
that appears only inside it, and confirm the card, the filename and the
snippet. Then repeat as a non-attendee against a confidential meeting and
confirm nothing comes back. Record both outcomes in the ledger.

- [ ] **Step 7: Report, do not merge**

Summarise counts and the two manual checks. Merging and the version bump are
the controller's call with the user — per CLAUDE.md the user confirms the
level. Expect **minor**: new capability, additive migration, no operator
action. Note that Task 1 changed `Dockerfile.kaneo`, so the first deploy
after this rebuilds with new Alpine packages and will be slower than usual.

---

## Self-Review

**Spec coverage.** Schema → Task 2 (all fields; `actionUpdateId` already
exists from C). Upload: PDF-only both ends → C, re-verified in Task 7 case 7;
client compression and both copies → Task 9; many documents per meeting →
Tasks 7 and 9; Overview tab display with indexing state → Task 9.
Extraction/OCR → Tasks 3 and 5; `trackBackgroundWork` → Task 5; one at a
time → Task 5's serial queue; failure visible and retryable → Tasks 5, 7, 9.
The "indexing state is not optional" section → Task 9 (per row) and Task 10
(the search-wide notice). Search → Task 8; confidentiality in the same query
→ Task 8 Steps 3-4 and its test 2. Testing section: unit OCR-fallback
decision → Task 3; unit snippet builder → Task 4; all seven integration
bullets → Tasks 7 and 8; the three web bullets → Tasks 9 and 10.
Out-of-scope items are absent: no non-PDF formats, no re-OCR beyond retry,
no cross-module search, no PDF highlighting, no original-deletion path.

**Placeholders.** None. Every code step carries real code; the two mostly-UI
tasks (9, 10) carry named test cases and explicit component requirements
rather than "implement the UI". Task 7 Step 1 names each of its eight cases
and what each must assert.

**Type consistency.** `PdfTextExtractor` / `ExtractionResult` (Task 3) are
consumed unchanged by Task 5. `enqueueDocumentIndexing(documentId: string)`
is called identically in Tasks 6 and 7. `buildSnippet(text, term, radius?)`
(Task 4) is called with two arguments in Task 8. `MatchedDocument` is
defined in Task 8 and consumed in Task 10. Column names are fixed in Task 2
and used verbatim thereafter: `originalObjectKey`, `indexStatus`,
`indexedAt`, `indexError`, `extractedText`, `extractedTextSearch`.

**Known gaps, deliberately left.** (1) No delete route for archival
documents — the spec does not ask for one, and C has no delete either, so a
document's only removal path is meeting cascade. (2) `sha256` stays
unpopulated, as it is in C. (3) The `tsvector` is built and indexed but not
yet queried (Task 8 Step 3 explains why and forbids deleting it). All three
belong in the ledger's parked list, not in a task.
