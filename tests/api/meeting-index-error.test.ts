import { describe, expect, it } from "vitest";
import { classifyExtractionError } from "../../apps/api/src/meeting/indexing";

describe("classifyExtractionError", () => {
  it("never returns the raw message", () => {
    const raw =
      "Error: ENOENT: no such file or directory, open '/tmp/kaneo-pdf-Xa9/input.pdf'";
    const out = classifyExtractionError(raw);
    expect(out).not.toContain("/tmp/");
    expect(out).not.toContain("ENOENT");
  });

  it("classifies a missing binary as a server-side tooling problem", () => {
    expect(classifyExtractionError("spawn pdftotext ENOENT")).toMatch(
      /tooling unavailable/i,
    );
  });

  it("classifies an unreadable stored object", () => {
    expect(classifyExtractionError("NoSuchKey: key does not exist")).toMatch(
      /could not be read/i,
    );
  });

  it("falls back to a generic reason for anything unrecognised", () => {
    expect(classifyExtractionError("weird internal failure 0x8")).toBe(
      "Extraction failed",
    );
  });

  it("returns a short single-line string for every branch", () => {
    for (const raw of [
      "spawn tesseract ENOENT",
      "ETIMEDOUT",
      "NoSuchKey",
      "stdout maxBuffer length exceeded",
      "PDF file is damaged",
      "something else",
    ]) {
      const out = classifyExtractionError(raw);
      expect(out.length).toBeLessThan(80);
      expect(out).not.toMatch(/[\n\r]/);
    }
  });
});
