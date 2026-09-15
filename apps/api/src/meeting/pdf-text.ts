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
