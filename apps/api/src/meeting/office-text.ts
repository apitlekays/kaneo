import * as CFB from "cfb";
import { unzipSync } from "fflate";
import WordExtractor from "word-extractor";

/**
 * Plain-text extraction for Word and PowerPoint files, in-process and with
 * no system binaries: the server image stays as it is, and nothing here
 * shells out. Scanned images pasted into an Office file are NOT read; only
 * a PDF gets the OCR fallback (see `pdf-text.ts`).
 */

// A .pptx is a zip. Its slide XML is small, so anything claiming to inflate
// past this is either not a presentation or a zip bomb, and stops here
// rather than exhausting memory on a box shared with Postgres and MinIO.
const MAX_PPTX_XML_BYTES = 64 * 1024 * 1024;

/** .doc and .docx both: word-extractor reads the binary and the OOXML form. */
export async function extractWordText(bytes: Buffer): Promise<string> {
  const doc = await new WordExtractor().extract(bytes);
  return [
    doc.getHeaders({ includeFooters: true }),
    doc.getBody(),
    doc.getTextboxes({ includeHeadersAndFooters: false, includeBody: true }),
    doc.getFootnotes(),
    doc.getEndnotes(),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** The text runs of one DrawingML part, one paragraph per line. */
function drawingMlText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((paragraph) =>
      [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)]
        .map((m) => decodeXmlText(m[1] ?? ""))
        .join(""),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** `ppt/slides/slide12.xml` sorts after `slide2.xml`, as a reader expects. */
function partNumber(name: string): number {
  return Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

export function extractPptxText(bytes: Buffer): string {
  let budget = MAX_PPTX_XML_BYTES;
  const files = unzipSync(new Uint8Array(bytes), {
    // Inflate only slides and speaker notes, and refuse to inflate past the
    // budget. `originalSize` is what the archive claims, which is the
    // number a bomb lies about, so the decompressed length is checked again
    // below.
    filter: (file) => {
      if (
        !/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(
          file.name,
        )
      )
        return false;
      budget -= file.originalSize;
      if (budget < 0) throw new Error("The document is too large to index");
      return true;
    },
  });

  const decoder = new TextDecoder();
  let inflated = 0;
  const read = (name: string) => {
    const data = files[name];
    if (!data) return "";
    inflated += data.length;
    if (inflated > MAX_PPTX_XML_BYTES)
      throw new Error("The document is too large to index");
    return drawingMlText(decoder.decode(data));
  };

  const slides = Object.keys(files)
    .filter((n) => n.startsWith("ppt/slides/"))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const notes = new Map(
    Object.keys(files)
      .filter((n) => n.startsWith("ppt/notesSlides/"))
      .map((n) => [partNumber(n), n]),
  );

  // Notes are matched to slides by number. That is the usual pairing but
  // not a guarantee (the real link is in the slide's .rels), and for search
  // all that matters is that the words are present.
  return slides
    .map((name) => {
      const note = notes.get(partNumber(name));
      return [read(name), note ? read(note) : ""].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

// PowerPoint 97-2003 record types that hold slide text.
const TEXT_CHARS_ATOM = 0x0fa0; // UTF-16LE
const TEXT_BYTES_ATOM = 0x0fa8; // one byte per character (Latin-1)
const CONTAINER_VERSION = 0xf;

/**
 * A legacy .ppt is a compound file whose "PowerPoint Document" stream is a
 * tree of records, each an 8-byte header (version and instance, type,
 * length) and a body. Containers (version 0xF) hold more records, so the
 * walk steps INTO a container's body and OVER an atom's. Text lives in two
 * atom types, wherever they sit: in the slide list and inside shapes.
 *
 * A fast-saved file keeps superseded copies of edited text, so identical
 * strings are kept once. Master-slide placeholder text ("Click to edit
 * Master title style") comes through too; it is harmless noise for search.
 */
export function extractPptText(bytes: Buffer): string {
  const file = CFB.read(bytes, { type: "buffer" });
  const entry = CFB.find(file, "PowerPoint Document");
  if (!entry?.content) throw new Error("The document could not be read");
  const stream = Buffer.from(entry.content as Uint8Array);

  const seen = new Set<string>();
  const out: string[] = [];
  let offset = 0;
  while (offset + 8 <= stream.length) {
    const versionAndInstance = stream.readUInt16LE(offset);
    const type = stream.readUInt16LE(offset + 2);
    const length = stream.readUInt32LE(offset + 4);
    const body = offset + 8;
    if ((versionAndInstance & 0x000f) === CONTAINER_VERSION) {
      offset = body;
      continue;
    }
    // A length running past the stream means a damaged or truncated file;
    // keep what was read so far rather than reading garbage.
    if (body + length > stream.length) break;
    if (type === TEXT_CHARS_ATOM || type === TEXT_BYTES_ATOM) {
      const raw = stream.subarray(body, body + length);
      const text = (
        type === TEXT_CHARS_ATOM
          ? raw.toString("utf16le")
          : raw.toString("latin1")
      )
        .replace(/[\r\v]/g, "\n")
        .trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    offset = body + length;
  }
  return out.join("\n");
}
