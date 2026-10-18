import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as CFB from "cfb";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractDocumentText } from "../../../apps/api/src/meeting/document-text";
import { isArchivalDocumentType } from "../../../apps/api/src/meeting/document-types";
import {
  extractPptText,
  extractPptxText,
  extractWordText,
} from "../../../apps/api/src/meeting/office-text";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../fixtures/office", name));

// Both fixtures were saved from the same two lines of text.
const EXPECTED = [
  "Minit Mesyuarat Jawatankuasa Kali ke-12",
  "Perbelanjaan tahunan diluluskan sebanyak RM50,000.",
];

function slideXml(...paragraphs: string[]) {
  return `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:txBody>${paragraphs
    .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sld>`;
}

function record(type: number, body: Buffer, container = false) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(container ? 0x000f : 0x0000, 0);
  header.writeUInt16LE(type, 2);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function pptFile(stream: Buffer) {
  const file = CFB.utils.cfb_new();
  CFB.utils.cfb_add(file, "PowerPoint Document", stream);
  return Buffer.from(CFB.write(file, { type: "buffer" }) as Uint8Array);
}

describe("Word extraction", () => {
  it("reads a legacy .doc", async () => {
    const text = await extractWordText(fixture("minutes.doc"));
    for (const line of EXPECTED) expect(text).toContain(line);
  });

  it("reads a .docx", async () => {
    const text = await extractWordText(fixture("minutes.docx"));
    for (const line of EXPECTED) expect(text).toContain(line);
  });
});

describe("PowerPoint extraction", () => {
  it("reads .pptx slides in slide order with their notes, decoding entities", () => {
    const pptx = Buffer.from(
      zipSync({
        "ppt/slides/slide10.xml": strToU8(slideXml("Tenth")),
        "ppt/slides/slide2.xml": strToU8(
          slideXml("Second &amp; last", "Bajet"),
        ),
        "ppt/notesSlides/notesSlide2.xml": strToU8(slideXml("Speaker note")),
        "ppt/media/image1.png": new Uint8Array([1, 2, 3]),
      }),
    );
    expect(extractPptxText(pptx)).toBe(
      "Second & last\nBajet\nSpeaker note\n\nTenth",
    );
  });

  it("reads text atoms out of a legacy .ppt, inside containers, once each", () => {
    const chars = record(0x0fa0, Buffer.from("Agenda mesyuarat", "utf16le"));
    const bytes = record(0x0fa8, Buffer.from("Laporan kewangan", "latin1"));
    const other = record(0x03ef, Buffer.from([0, 0, 0, 0]));
    const stream = Buffer.concat([
      record(0x03e8, Buffer.concat([other, chars, bytes]), true),
      chars,
    ]);
    expect(extractPptText(pptFile(stream))).toBe(
      "Agenda mesyuarat\nLaporan kewangan",
    );
  });

  it("stops at a record whose length runs past the stream", () => {
    const good = record(0x0fa8, Buffer.from("Kept", "latin1"));
    const bad = Buffer.alloc(8);
    bad.writeUInt16LE(0x0fa8, 2);
    bad.writeUInt32LE(9999, 4);
    expect(extractPptText(pptFile(Buffer.concat([good, bad])))).toBe("Kept");
  });
});

describe("routing by type", () => {
  it("refuses a type it has no extractor for", async () => {
    await expect(
      extractDocumentText(Buffer.from(""), "text/plain"),
    ).rejects.toThrow("Unsupported document type");
  });

  it("requires the extension to agree with the type", () => {
    expect(isArchivalDocumentType("application/msword", "Minit.DOC")).toBe(
      true,
    );
    expect(isArchivalDocumentType("application/msword", "minit.pdf")).toBe(
      false,
    );
    expect(isArchivalDocumentType("text/plain", "notes.txt")).toBe(false);
  });
});
