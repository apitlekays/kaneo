import { PDF_MIME_TYPE } from "./document-types";
import {
  extractPptText,
  extractPptxText,
  extractWordText,
} from "./office-text";
import { type ExtractionSource, extractPdfText } from "./pdf-text";

export type DocumentExtractionResult = {
  text: string;
  source: ExtractionSource | "office";
};

/**
 * The indexing seam: bytes and their MIME type in, text out. Production uses
 * `extractDocumentText`; the integration suite injects a fake so it needs
 * neither poppler nor tesseract.
 */
export type DocumentTextExtractor = (
  bytes: Buffer,
  mimeType: string,
) => Promise<DocumentExtractionResult>;

/**
 * Route a stored archival document to the extractor for its type. PDFs keep
 * the text-layer-then-OCR pipeline; Word and PowerPoint are read in-process.
 * The MIME type is the one recorded at finalize, which the upload gate has
 * already checked against the filename.
 */
export const extractDocumentText: DocumentTextExtractor = async (
  bytes,
  mimeType,
) => {
  switch (mimeType) {
    case PDF_MIME_TYPE:
      return extractPdfText(bytes);
    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return { text: await extractWordText(bytes), source: "office" };
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return { text: extractPptxText(bytes), source: "office" };
    case "application/vnd.ms-powerpoint":
      return { text: extractPptText(bytes), source: "office" };
    default:
      throw new Error("Unsupported document type");
  }
};
