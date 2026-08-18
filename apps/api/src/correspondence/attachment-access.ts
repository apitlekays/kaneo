export type AttachmentAccessKind = "preview" | "download";

/**
 * Rendering an attachment inline hits the same route as taking a copy of it.
 * Both are recorded — a reader of a classified surat must never be invisible —
 * but they are recorded distinctly so a glance is not mistaken for a download.
 */
export function attachmentAuditAction(query: {
  preview?: string;
}): AttachmentAccessKind {
  return query.preview === "true" ? "preview" : "download";
}
