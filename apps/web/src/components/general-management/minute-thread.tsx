import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  attachmentDownloadUrl,
  type LetterAttachment,
  type LetterMinute,
  type MinuteUpdate,
  uploadLetterAttachment,
} from "@/fetchers/correspondence/letters";
import { useAddMinuteUpdate } from "@/hooks/queries/correspondence/use-letters";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { formatDateMedium } from "@/lib/format";
import { isPdfUpload } from "@/lib/is-pdf-upload";
import { toast } from "@/lib/toast";
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
  const qc = useQueryClient();
  const addUpdate = useAddMinuteUpdate(workspaceId, letterId);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimmed = body.trim();

  const attachmentsFor = (updateId: string) =>
    attachments.filter((att) => att.minuteUpdateId === updateId);

  const resetFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    if (!trimmed) return;
    const toAttach = file;
    addUpdate.mutate(
      { minuteId: minute.id, body: trimmed },
      {
        onSuccess: async (update: MinuteUpdate) => {
          setBody("");
          resetFile();
          if (!toAttach) return;
          // The update itself is already saved at this point — a failed
          // upload from here on must not read as "the update didn't go
          // through"; it must read as "the file didn't attach".
          setUploading(true);
          try {
            await uploadLetterAttachment(
              workspaceId,
              letterId,
              toAttach,
              "original",
              update.id,
            );
            // Both the thread (filtered by minuteUpdateId) and the
            // Attachments tab read off this same query, so one invalidation
            // refreshes the file into both places without a manual reload.
            qc.invalidateQueries({
              queryKey: ["letter", workspaceId, letterId],
            });
          } catch {
            toast.error("Update posted, but the attachment upload failed");
          } finally {
            setUploading(false);
          }
        },
      },
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
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              if (picked && !isPdfUpload(picked)) {
                toast.error("Only PDF files can be attached to a letter");
                e.target.value = "";
                return;
              }
              setFile(picked);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" />
              {file ? file.name : "Attach file"}
            </Button>
            {file && (
              <button
                type="button"
                className="text-muted-foreground text-xs underline hover:text-foreground"
                onClick={resetFile}
              >
                Remove
              </button>
            )}
            <Button
              size="sm"
              disabled={!trimmed || addUpdate.isPending || uploading}
              onClick={submit}
              className="ml-auto"
            >
              {(addUpdate.isPending || uploading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Post update
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
