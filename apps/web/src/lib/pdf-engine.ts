import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import type { PdfEngine, RenderedPage } from "./compress-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

// PDF user units are 1/72 inch. 150 DPI keeps a typed letter legible while
// cutting a 300 DPI scan to a quarter of its pixels.
const PDF_UNITS_PER_INCH = 72;
const TARGET_DPI = 150;
const JPEG_QUALITY = 0.7;

// Enough pages to tell a scan from a digital PDF without reading a 200-page file.
const TEXT_SAMPLE_PAGES = 3;

export function createPdfEngine(): PdfEngine {
  return {
    async open(bytes: ArrayBuffer) {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
        .promise;

      return {
        pageCount: doc.numPages,

        async textLength() {
          let total = 0;
          const sample = Math.min(doc.numPages, TEXT_SAMPLE_PAGES);
          for (let i = 1; i <= sample; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            for (const item of content.items) {
              if ("str" in item) total += item.str.trim().length;
            }
            page.cleanup();
          }
          return total;
        },

        async renderPage(index: number): Promise<RenderedPage> {
          const page = await doc.getPage(index + 1);
          const unscaled = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: TARGET_DPI / PDF_UNITS_PER_INCH,
          });

          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context unavailable");

          // JPEG has no alpha channel; without this, transparent areas go black.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvas, viewport }).promise;

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
          );

          // Release the bitmap before the next page allocates its own.
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();

          if (!blob) throw new Error("Failed to encode page as JPEG");
          return {
            jpeg: new Uint8Array(await blob.arrayBuffer()),
            width: unscaled.width,
            height: unscaled.height,
          };
        },
      };
    },

    async build(pages: RenderedPage[]) {
      const out = await PDFDocument.create();
      for (const rendered of pages) {
        const image = await out.embedJpg(rendered.jpeg);
        const page = out.addPage([rendered.width, rendered.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: rendered.width,
          height: rendered.height,
        });
      }
      return out.save({ useObjectStreams: true });
    },
  };
}
