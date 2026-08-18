import { describe, expect, it } from "vitest";
import { isPdfUpload } from "./is-pdf-upload";

const file = (name: string, type: string) =>
  new File([new Uint8Array(4)], name, { type });

describe("isPdfUpload", () => {
  it("accepts a PDF", () => {
    expect(isPdfUpload(file("surat.pdf", "application/pdf"))).toBe(true);
  });

  it("accepts a .pdf whose MIME type the browser did not report", () => {
    // Some systems hand over an empty type; the extension is all we have.
    expect(isPdfUpload(file("surat.pdf", ""))).toBe(true);
  });

  it("rejects a Word document", () => {
    expect(
      isPdfUpload(
        file(
          "surat.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).toBe(false);
  });

  it("rejects an image", () => {
    expect(isPdfUpload(file("scan.png", "image/png"))).toBe(false);
  });

  it("rejects a typeless file that is not named .pdf", () => {
    expect(isPdfUpload(file("surat.docx", ""))).toBe(false);
  });

  it("ignores case in the extension", () => {
    expect(isPdfUpload(file("SURAT.PDF", ""))).toBe(true);
  });
});
