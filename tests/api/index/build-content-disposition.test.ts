import { describe, expect, it } from "vitest";
import { buildContentDisposition } from "../../../apps/api/src/index";

// buildContentDisposition emits two things: an ASCII fallback in the plain
// `filename=` parameter, and the correct name percent-encoded in the RFC
// 5987 `filename*=UTF-8''...` parameter. Modern browsers prefer filename*,
// so only clients that ignore it ever see the ASCII fallback — but it must
// still be right.
describe("buildContentDisposition", () => {
  it("passes an ASCII name through unchanged", () => {
    const header = buildContentDisposition("laporan.pdf");
    expect(header).toContain('filename="laporan.pdf"');
    expect(header).toContain("filename*=UTF-8''laporan.pdf");
  });

  it("does not mangle v/w/x/y/z in the ASCII fallback (regression)", () => {
    // A broken /[^\x20-\u7E]+/g class (identity-escape \u followed by
    // literal "7E") silently ends the range at "u" (0x75), replacing every
    // character from "v" (0x76) upward with "_". This must not happen.
    const header = buildContentDisposition("laporan-vwxyz.pdf");
    expect(header).toContain('filename="laporan-vwxyz.pdf"');
  });

  it("preserves a .docx extension", () => {
    const header = buildContentDisposition("surat_v2.docx");
    expect(header).toContain('filename="surat_v2.docx"');
  });

  it("produces a sensible ASCII fallback and a correct filename* for a Malay/Jawi name", () => {
    const header = buildContentDisposition("Mesyuarat Agung.pdf");
    // Non-ASCII-containing names still fall back sensibly for the plain
    // parameter (no data loss for the parts that are ASCII)...
    expect(header).toContain('filename="Mesyuarat Agung.pdf"');
    // ...while filename* carries the exact original name, percent-encoded.
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent("Mesyuarat Agung.pdf")}`,
    );

    const arabicHeader = buildContentDisposition("مسودة.pdf");
    // The Arabic-script characters aren't printable ASCII, so the fallback
    // collapses them to underscores rather than mangling them silently.
    expect(arabicHeader).toContain('filename="_.pdf"');
    expect(arabicHeader).toContain(
      `filename*=UTF-8''${encodeURIComponent("مسودة.pdf")}`,
    );
  });

  it("strips CR/LF and quotes from the filename", () => {
    const header = buildContentDisposition('evil\r\nname".pdf');
    // The header legitimately contains literal `"` characters as part of
    // the filename="..." syntax itself; what must not survive is a CR, LF,
    // or quote that came from the (attacker-controlled) input.
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="evilname.pdf"');
  });
});
