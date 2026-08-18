import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PdfEngine } from "@/lib/compress-pdf";
import { usePdfCompression } from "./use-pdf-compression";

function pdfFile(name: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/** Renders pages only when `release` is called, so a run can be held open. */
function gatedEngine(pageCount: number) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const engine: PdfEngine = {
    open: async () => ({
      pageCount,
      textLength: async () => 0,
      renderPage: async () => {
        await gate;
        return { jpeg: new Uint8Array(10), width: 595, height: 842 };
      },
    }),
    build: async () => new Uint8Array(100),
  };
  return { engine, release: () => release() };
}

function instantEngine(builtBytes: number): PdfEngine {
  return {
    open: async () => ({
      pageCount: 2,
      textLength: async () => 0,
      renderPage: async () => ({
        jpeg: new Uint8Array(10),
        width: 595,
        height: 842,
      }),
    }),
    build: async () => new Uint8Array(builtBytes),
  };
}

describe("usePdfCompression", () => {
  it("starts idle with nothing to report", () => {
    const { result } = renderHook(() => usePdfCompression());

    expect(result.current.busy).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it("reports busy while running and exposes the result when done", async () => {
    const { result } = renderHook(() => usePdfCompression());
    const { engine, release } = gatedEngine(2);

    act(() => {
      result.current.run(pdfFile("scan.pdf", 8000), engine);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      release();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.result?.finalSize).toBe(100);
    expect(result.current.result?.skipped).toBeNull();
  });

  it("tracks page progress as pages render", async () => {
    const { result } = renderHook(() => usePdfCompression());

    await act(async () => {
      await result.current.run(pdfFile("scan.pdf", 8000), instantEngine(100));
    });

    expect(result.current.progress).toEqual({ page: 2, total: 2 });
  });

  it("cancel stops the run and keeps the original file usable", async () => {
    const { result } = renderHook(() => usePdfCompression());
    const { engine, release } = gatedEngine(4);
    const scan = pdfFile("scan.pdf", 8000);

    act(() => {
      result.current.run(scan, engine);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      release();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.result?.skipped).toBe("cancelled");
    expect(result.current.result?.file).toBe(scan);
  });

  it("reset clears the reported result", async () => {
    const { result } = renderHook(() => usePdfCompression());

    await act(async () => {
      await result.current.run(pdfFile("scan.pdf", 8000), instantEngine(100));
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("starting a second run cancels the first so its result cannot land late", async () => {
    const { result } = renderHook(() => usePdfCompression());
    const first = gatedEngine(4);

    act(() => {
      result.current.run(pdfFile("first.pdf", 8000), first.engine);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      await result.current.run(pdfFile("second.pdf", 9000), instantEngine(200));
    });
    await act(async () => {
      first.release();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.result?.file.name).toBe("second.pdf");
    expect(result.current.result?.finalSize).toBe(200);
  });
});
