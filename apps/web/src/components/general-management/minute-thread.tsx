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
import { AttachmentRow } from "./attachment-row";

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
