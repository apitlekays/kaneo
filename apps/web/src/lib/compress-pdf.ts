export type RenderedPage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
};

export type PdfSource = {
  pageCount: number;
  textLength(): Promise<number>;
  renderPage(index: number): Promise<RenderedPage>;
};

export type PdfEngine = {
  open(bytes: ArrayBuffer): Promise<PdfSource>;
  build(pages: RenderedPage[]): Promise<Uint8Array>;
};

export type CompressionSkipReason =
  | "not-pdf"
  | "has-text"
  | "no-gain"
  | "cancelled";

export type CompressionResult = {
  file: File;
  originalSize: number;
  finalSize: number;
  skipped: CompressionSkipReason | null;
};

export type CompressOptions = {
  engine?: PdfEngine;
  signal?: AbortSignal;
  onProgress?: (page: number, total: number) => void;
};

// A scan carries no real text. Digital PDFs carry plenty. Anything under this
// is OCR noise or a stray watermark, not a text layer worth preserving.
const MIN_TEXT_CHARS = 100;

function untouched(
  file: File,
  skipped: CompressionSkipReason | null,
): CompressionResult {
  return {
    file,
    originalSize: file.size,
    finalSize: file.size,
    skipped,
  };
}

export async function compressPdfIfScanned(
  file: File,
  opts: CompressOptions = {},
): Promise<CompressionResult> {
  const { signal, onProgress } = opts;

  if (file.type !== "application/pdf") return untouched(file, "not-pdf");
  if (signal?.aborted) return untouched(file, "cancelled");

  const engine = opts.engine ?? (await loadDefaultEngine());
  const source = await engine.open(await file.arrayBuffer());

  if ((await source.textLength()) >= MIN_TEXT_CHARS)
    return untouched(file, "has-text");

  const pages: RenderedPage[] = [];
  for (let i = 0; i < source.pageCount; i++) {
    if (signal?.aborted) return untouched(file, "cancelled");
    pages.push(await source.renderPage(i));
    onProgress?.(i + 1, source.pageCount);
  }
  if (signal?.aborted) return untouched(file, "cancelled");

  const bytes = await engine.build(pages);
  if (bytes.byteLength >= file.size) return untouched(file, "no-gain");

  return {
    file: new File([bytes], file.name, { type: "application/pdf" }),
    originalSize: file.size,
    finalSize: bytes.byteLength,
    skipped: null,
  };
}

// Kept behind a dynamic import so pdf.js and pdf-lib stay out of the main
// bundle until someone actually attaches a PDF.
async function loadDefaultEngine(): Promise<PdfEngine> {
  const { createPdfEngine } = await import("./pdf-engine");
  return createPdfEngine();
}
