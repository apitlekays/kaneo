/**
 * Moved out of `index.ts` unchanged so any route module can build a safe
 * `Content-Disposition` header without importing back from the app root
 * (which mounts most feature modules, including this file's other callers,
 * and would create an import cycle).
 *
 * Strips `[\r\n"]` from the filename before it ever reaches the header —
 * CR/LF is response-splitting, and `"` breaks out of the quoted `filename=`
 * parameter — and emits an RFC 5987 `filename*=UTF-8''…` alongside a plain
 * ASCII fallback so non-ASCII names (Malay, Arabic-script, …) still arrive
 * intact for clients that honour it.
 */
export function buildContentDisposition(filename: string) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[\r\n"]/g, "")
    .trim();
  const safeFilename = normalized || "file";
  const asciiFallback =
    safeFilename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/]/g, "-")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file";
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}
