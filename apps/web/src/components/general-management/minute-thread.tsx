import { Download, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  attachmentDownloadUrl,
  type LetterAttachment,
  type LetterMinute,
} from "@/fetchers/correspondence/letters";
import { useAddMinuteUpdate } from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { formatDateMedium } from "@/lib/format";

/** Shared row shell for a letter attachment: the thread and the Attachments
 * tab both need "filename + download", so this is the one place that owns
 * that markup. `badge` and `trailing` are extra slots the Attachments tab
 * uses for the primary marker and the PDF preview toggle; `children` renders
 * below the row (e.g. an inline preview iframe). */
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

type MinuteThreadProps = {
  workspaceId: string;
  letterId: string;
  minute: LetterMinute;
  canPost: boolean;
  /**
   * The letter's full attachment list. Optional and defaulted to `[]` so
   * existing call sites that don't have it handy still compile; matched to
   * each update by `minuteUpdateId`.
   */
  attachments?: LetterAttachment[];
};

export function MinuteThread({
  workspaceId,
  letterId,
  minute,
  canPost,
  attachments = [],
}: MinuteThreadProps) {
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : "—";
  const addUpdate = useAddMinuteUpdate(workspaceId, letterId);
  const [body, setBody] = useState("");
  const trimmed = body.trim();

  const attachmentsFor = (updateId: string) =>
    attachments.filter((att) => att.minuteUpdateId === updateId);

  const submit = () => {
    if (!trimmed) return;
    addUpdate.mutate(
      { minuteId: minute.id, body: trimmed },
      { onSuccess: () => setBody("") },
    );
  };

  return (
    <div className="mt-2 space-y-2 border-border border-t pt-2">
      {minute.updates.map((update) => (
        <div key={update.id} className="space-y-1 text-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{userName(update.authorId)}</span>
            <span>{formatDateMedium(update.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap">{update.body}</p>
          {attachmentsFor(update.id).map((att) => (
            <AttachmentRow
              key={att.id}
              attachment={att}
              downloadHref={attachmentDownloadUrl(
                workspaceId,
                letterId,
                att.id,
              )}
            />
          ))}
        </div>
      ))}
      {canPost && (
        <div className="space-y-2 pt-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Post an update…"
            className="min-h-20"
          />
          <Button
            size="sm"
            disabled={!trimmed || addUpdate.isPending}
            onClick={submit}
          >
            Post update
          </Button>
        </div>
      )}
    </div>
  );
}
