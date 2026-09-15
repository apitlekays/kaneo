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

  it("does not blame the server tooling for an object-store miss", () => {
    // Regression: the storage branch used to sit AFTER a tooling branch that
    // tested a bare "not found", so MinIO's "Object not found" reported as
    // "Extraction tooling unavailable" and sent the reader after the wrong
    // system. Both phrasings must land on the storage message.
    for (const raw of [
      "NoSuchKey: The specified key does not exist.",
      "Object not found",
      "S3ServiceException: no such key",
    ]) {
      expect(classifyExtractionError(raw)).toMatch(/could not be read/i);
    }
  });

  it("still reports a genuinely missing binary as a tooling problem", () => {
    // The distinguishing signal: a missing binary surfaces as ENOENT from
    // spawn, never as a bare "not found".
    for (const raw of ["spawn pdftotext ENOENT", "spawn tesseract ENOENT"]) {
      expect(classifyExtractionError(raw)).toMatch(/tooling unavailable/i);
    }
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
