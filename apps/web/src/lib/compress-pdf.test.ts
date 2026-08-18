import { describe, expect, it, vi } from "vitest";
import {
  compressPdfIfScanned,
  type PdfEngine,
  type RenderedPage,
} from "./compress-pdf";

function pdfFile(name: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/**
 * Stands in for pdf.js + pdf-lib. jsdom cannot rasterize a canvas, so the real
 * engine is verified by hand; everything around it is exercised here.
 */
function fakeEngine(opts: {
  pageCount?: number;
  textLength?: number;
  builtBytes?: number;
  onRender?: (index: number) => void;
}): PdfEngine {
  const pageCount = opts.pageCount ?? 3;
  return {
    open: async () => ({
      pageCount,
      textLength: async () => opts.textLength ?? 0,
      renderPage: async (index: number): Promise<RenderedPage> => {
        opts.onRender?.(index);
        return { jpeg: new Uint8Array(10), width: 595, height: 842 };
      },
    }),
    build: async () => new Uint8Array(opts.builtBytes ?? 100),
  };
}

describe("compressPdfIfScanned", () => {
  it("leaves a file that is not a PDF untouched", async () => {
    const docx = new File([new Uint8Array(5000)], "letter.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const result = await compressPdfIfScanned(docx, {
      engine: fakeEngine({ builtBytes: 10 }),
    });

    expect(result.skipped).toBe("not-pdf");
    expect(result.file).toBe(docx);
    expect(result.finalSize).toBe(5000);
  });

  it("leaves a PDF that has a real text layer untouched", async () => {
    const digital = pdfFile("surat.pdf", 4000);

    const result = await compressPdfIfScanned(digital, {
      engine: fakeEngine({ textLength: 5000, builtBytes: 10 }),
    });

    expect(result.skipped).toBe("has-text");
    expect(result.file).toBe(digital);
  });

  it("compresses a scan that carries no text layer", async () => {
    const scan = pdfFile("scan.pdf", 8000);

    const result = await compressPdfIfScanned(scan, {
      engine: fakeEngine({ textLength: 0, builtBytes: 900 }),
    });

    expect(result.skipped).toBeNull();
    expect(result.originalSize).toBe(8000);
    expect(result.finalSize).toBe(900);
    expect(result.file).not.toBe(scan);
    expect(result.file.name).toBe("scan.pdf");
    expect(result.file.type).toBe("application/pdf");
  });

  it("keeps the original when the rebuilt PDF is not smaller", async () => {
    const bilevelScan = pdfFile("fax.pdf", 500);

    const result = await compressPdfIfScanned(bilevelScan, {
      engine: fakeEngine({ textLength: 0, builtBytes: 4000 }),
    });

    expect(result.skipped).toBe("no-gain");
    expect(result.file).toBe(bilevelScan);
    expect(result.finalSize).toBe(500);
  });

  it("reports progress once per rendered page", async () => {
    const onProgress = vi.fn();

    await compressPdfIfScanned(pdfFile("scan.pdf", 8000), {
      engine: fakeEngine({ pageCount: 3, textLength: 0, builtBytes: 900 }),
      onProgress,
    });

    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("stops rendering further pages once the signal aborts", async () => {
    const controller = new AbortController();
    const rendered: number[] = [];

    const result = await compressPdfIfScanned(pdfFile("scan.pdf", 8000), {
      engine: fakeEngine({
        pageCount: 10,
        textLength: 0,
        builtBytes: 900,
        onRender: (index) => {
          rendered.push(index);
          if (index === 1) controller.abort();
        },
      }),
      signal: controller.signal,
    });

    expect(rendered.length).toBeLessThan(10);
    expect(result.skipped).toBe("cancelled");
  });

  it("returns the original file when cancelled so the upload can still proceed", async () => {
    const scan = pdfFile("scan.pdf", 8000);
    const controller = new AbortController();
    controller.abort();

    const result = await compressPdfIfScanned(scan, {
      engine: fakeEngine({ textLength: 0, builtBytes: 900 }),
      signal: controller.signal,
    });

    expect(result.skipped).toBe("cancelled");
    expect(result.file).toBe(scan);
    expect(result.finalSize).toBe(8000);
  });
});
