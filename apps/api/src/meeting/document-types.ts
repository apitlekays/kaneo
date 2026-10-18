/**
 * The file types a meeting-level archival document may be. Reply
 * attachments on an action thread stay PDF-only; this wider list is for the
 * archive, where past minutes arrive as whatever the secretary of the day
 * used.
 *
 * Each MIME type is paired with the extensions that may carry it, and both
 * must agree: the browser reports the type from the extension, so a
 * mismatch means something renamed the file or forged the request.
 */
export const ARCHIVAL_DOCUMENT_TYPES: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
};

export const PDF_MIME_TYPE = "application/pdf";

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * True when `mimeType` is an archival type and, if a filename is given,
 * its extension is one that type may carry. The filename is optional only
 * because the reindex route re-checks authority without one; every upload
 * path passes it.
 */
export function isArchivalDocumentType(
  mimeType: string,
  filename?: string,
): boolean {
  const extensions = ARCHIVAL_DOCUMENT_TYPES[mimeType];
  if (!extensions) return false;
  if (filename === undefined) return true;
  return extensions.includes(extensionOf(filename));
}
