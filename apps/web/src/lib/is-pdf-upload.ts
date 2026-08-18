/**
 * Correspondence attachments are PDFs. The file input's `accept` attribute is
 * only a hint — drag-and-drop bypasses it — so uploads are checked here too.
 *
 * Note this is a client-side guard, not enforcement: the presign route still
 * trusts the content type it is given.
 */
export function isPdfUpload(file: File): boolean {
  if (file.type === "application/pdf") return true;
  // Some systems report no MIME type at all; fall back to the extension.
  return file.type === "" && file.name.toLowerCase().endsWith(".pdf");
}
