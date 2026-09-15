import { describe, expect, it } from "vitest";
import {
  isMeaningfulText,
  MIN_MEANINGFUL_CHARS,
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
