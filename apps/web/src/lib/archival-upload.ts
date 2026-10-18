/**
 * The file types Meeting Minutes accepts as archival documents: PDF, Word
 * and PowerPoint. Mirrors `ARCHIVAL_DOCUMENT_TYPES` in the API's
 * `meeting/document-types.ts`, which is the actual gate; this only spares
 * the user an upload the server would refuse.
 */
const TYPES_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** For a file input's `accept`: the extensions and their MIME types. */
export const ARCHIVAL_ACCEPT = [
  ...Object.keys(TYPES_BY_EXTENSION),
  ...Object.values(TYPES_BY_EXTENSION),
].join(",");

export const ARCHIVAL_TYPES_LABEL =
  "PDF, Word (.doc, .docx) or PowerPoint (.ppt, .pptx)";

/**
 * The MIME type to upload `file` as, or null when it is not an archival
 * type. Read from the extension, not `file.type`: browsers report Office
 * types inconsistently (often empty, sometimes `application/octet-stream`),
 * and the server checks that the type and extension agree.
 */
export function archivalMimeType(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  if (dot === -1) return null;
  return TYPES_BY_EXTENSION[file.name.slice(dot).toLowerCase()] ?? null;
}
