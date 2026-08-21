import { Download, FileText } from "lucide-react";
import type { ReactNode } from "react";
import type { LetterAttachment } from "@/fetchers/correspondence/letters";

/** Shared row shell for a letter attachment: the minute thread and the
 * Attachments tab both need "filename + download", so this is the one place
 * that owns that markup. `badge` and `trailing` are extra slots the
 * Attachments tab uses for the primary marker and the PDF preview toggle;
 * `children` renders below the row (e.g. an inline preview iframe). */
export function AttachmentRow({
  attachment,
  downloadHref,
  badge,
  trailing,
  children,
}: {
  attachment: LetterAttachment;
  downloadHref: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border text-sm">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {attachment.filename}
          {badge}
        </span>
        <span className="flex items-center gap-3">
          {trailing}
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="h-4 w-4" />
          </a>
        </span>
      </div>
      {children}
    </div>
  );
}
