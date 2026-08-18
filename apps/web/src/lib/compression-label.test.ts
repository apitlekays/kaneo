import { describe, expect, it } from "vitest";
import type { CompressionResult } from "./compress-pdf";
import { compressionLabel } from "./compression-label";

function result(over: Partial<CompressionResult>): CompressionResult {
  return {
    file: new File([], "x.pdf", { type: "application/pdf" }),
    originalSize: 0,
    finalSize: 0,
    skipped: null,
    ...over,
  };
}

describe("compressionLabel", () => {
  it("shows the size the registrar saved when a scan was compressed", () => {
    expect(
      compressionLabel(
        result({
          skipped: null,
          originalSize: 8_200_000,
          finalSize: 1_150_000,
        }),
      ),
    ).toBe("compressed 8.2 MB → 1.1 MB");
  });

  it("says why a PDF with text was left alone", () => {
    expect(compressionLabel(result({ skipped: "has-text" }))).toBe(
      "left as-is — contains text",
    );
  });

  it("says why an already-compact scan was left alone", () => {
    expect(compressionLabel(result({ skipped: "no-gain" }))).toBe(
      "left as-is — already compact",
    );
  });

  it("says when the registrar cancelled", () => {
    expect(compressionLabel(result({ skipped: "cancelled" }))).toBe(
      "left as-is — compression cancelled",
    );
  });

  it("says nothing about a file that was never a PDF", () => {
    expect(compressionLabel(result({ skipped: "not-pdf" }))).toBeNull();
  });
});
