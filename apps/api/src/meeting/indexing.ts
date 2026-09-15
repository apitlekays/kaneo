import { eq } from "drizzle-orm";
import db from "../database";
import { meetingDocumentTable } from "../database/schema";
import { getPrivateObject } from "../storage/s3";
import { trackBackgroundWork } from "../utils/background-work";
import { extractPdfText, type PdfTextExtractor } from "./pdf-text";

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
 * Map a raw extraction failure to something safe to show a user. Never
 * return the raw string: it carries temp paths and tool version strings.
 * The operator's copy goes to the server log instead.
 */
export function classifyExtractionError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("enoent") || s.includes("not found"))
    return "Extraction tooling unavailable on the server";
  if (s.includes("timeout") || s.includes("etimedout"))
    return "Extraction timed out";
  if (s.includes("nosuchkey") || s.includes("not exist"))
    return "The stored file could not be read";
  if (s.includes("maxbuffer")) return "The document is too large to index";
  if (s.includes("damaged") || s.includes("malformed") || s.includes("syntax"))
    return "The PDF could not be read";
  return "Extraction failed";
}

/**
 * `AssetObject.body` is declared `unknown` in `storage/s3.ts`; at runtime
 * `getPrivateObject` always hands back a web `ReadableStream` (either
 * `transformToWebStream()` or `Readable.toWeb()`). Node's web streams are
 * async-iterable, so the iterator branch is the one production takes — the
 * reader branch is the honest fallback for a body that is a stream but not
 * iterable, so no `any` cast is needed anywhere.
 */
async function collectBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];

  if (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

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
    const { text } = await extractor(await collectBody(object.body));

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
    // A failed index must be VISIBLE and RETRYABLE, never silent — but
    // `indexError` is rendered in the browser (Task 7 returns it, Task 9
    // shows it), and a raw poppler/tesseract failure carries server
    // filesystem paths (/tmp/kaneo-pdf-*) and binary version strings. The
    // spec asked for a visible, retryable failure; it never asked for
    // stderr. So classify for the UI and log the real thing server-side.
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`[meeting-document] index failed ${documentId}:`, error);
    await db
      .update(meetingDocumentTable)
      .set({
        indexStatus: "failed",
        indexError: classifyExtractionError(raw),
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
