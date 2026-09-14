import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  listActionUpdates,
  type MeetingAction,
  type MeetingActionUpdate,
  type MeetingDocument,
  meetingDocumentDownloadUrl,
  uploadMeetingDocument,
} from "@/fetchers/meeting";
import { useAddActionUpdate } from "@/hooks/queries/meeting/use-meeting-mutations";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { formatDateMedium } from "@/lib/format";
import { isPdfUpload } from "@/lib/is-pdf-upload";
import { toast } from "@/lib/toast";

type ActionStatus = MeetingAction["status"];

const actionUpdatesKey = (
  workspaceId: string,
  meetingId: string,
  actionId: string,
) => ["meeting-action-updates", workspaceId, meetingId, actionId] as const;

/**
 * One action's append-only progress thread — the meeting-shaped twin of
 * `MinuteThread` (Letter Minutes). Unlike that component, the thread here is
 * NOT embedded in the parent's already-fetched detail payload — the API has
 * no such join — so this fetches it directly with its own `useQuery`, which
 * is why loading/error/empty need to be told apart explicitly rather than
 * falling out of a prop that's simply present or absent.
 *
 * There is no list-documents route for an update's attachments (only
 * presign/finalize/download), so attachments shown here are the ones
 * uploaded in THIS browser session, not a durable server-fetched list —
 * a real gap, not an oversight; a future archival/search spec is the
 * natural place to close it.
 */
export function ActionThread({
  workspaceId,
  meetingId,
  action,
  canPost,
}: {
  workspaceId: string;
  meetingId: string;
  action: MeetingAction;
  canPost: boolean;
}) {
  const { data: usersData } = useGetActiveWorkspaceUsers(workspaceId);
  const users = usersData?.members ?? [];
  const userName = (id: string | null) =>
    id ? (users.find((u) => u.userId === id)?.user?.name ?? id) : "—";

  const queryKey = actionUpdatesKey(workspaceId, meetingId, action.id);
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listActionUpdates(workspaceId, meetingId, action.id),
  });

  const qc = useQueryClient();
  const addUpdate = useAddActionUpdate(workspaceId, meetingId);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<ActionStatus | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentsByUpdate, setAttachmentsByUpdate] = useState<
    Record<string, MeetingDocument[]>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimmed = body.trim();

  const resetFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    if (!trimmed) return;
    const toAttach = file;
    addUpdate.mutate(
      {
        actionId: action.id,
        body: trimmed,
        statusAfter: status || undefined,
      },
      {
        onSuccess: async (created: MeetingActionUpdate) => {
          setBody("");
          setStatus("");
          resetFile();
          qc.invalidateQueries({ queryKey });
          if (!toAttach) return;
          // The update itself is already saved at this point — a failed
          // upload from here on must not read as "the update didn't go
          // through"; it must read as "the file didn't attach".
          setUploading(true);
          try {
            const doc = await uploadMeetingDocument(
              workspaceId,
              meetingId,
              toAttach,
              created.id,
            );
            setAttachmentsByUpdate((prev) => ({
              ...prev,
              [created.id]: [...(prev[created.id] ?? []), doc],
            }));
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
      {isLoading ? (
        <div
          className="flex items-center gap-2 py-2 text-muted-foreground text-xs"
          role="status"
          aria-label="Loading updates"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading updates…
        </div>
      ) : isError ? (
        <p className="text-destructive text-xs" role="alert">
          Couldn't load this action's updates. Try reopening this meeting.
        </p>
      ) : (
        <>
          {(data ?? []).length === 0 && (
            <p className="text-muted-foreground text-xs">No updates yet.</p>
          )}
          <ul className="space-y-1">
            {(data ?? []).map((update) => (
              <li key={update.id} className="space-y-1 text-sm">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>{userName(update.authorId)}</span>
                  <span>{formatDateMedium(update.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap">{update.body}</p>
                {update.statusAfter && (
                  <Badge variant="outline" className="text-xs">
                    Set status: {update.statusAfter}
                  </Badge>
                )}
                {(attachmentsByUpdate[update.id] ?? []).map((doc) => (
                  <a
                    key={doc.id}
                    href={meetingDocumentDownloadUrl(
                      workspaceId,
                      meetingId,
                      doc.id,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
                  >
                    <FileText className="h-3 w-3" />
                    {doc.filename}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {canPost && (
        <div className="space-y-2 pt-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Post an update…"
            className="min-h-16"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(v) => setStatus((v ?? "") as ActionStatus | "")}
            >
              <SelectTrigger className="w-44">
                <SelectValue>
                  {status ? `Mark ${status}` : "No status change"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Mark open</SelectItem>
                <SelectItem value="done">Mark done</SelectItem>
                <SelectItem value="cancelled">Mark cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              if (picked && !isPdfUpload(picked)) {
                toast.error("Only PDF files can be attached");
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
              {file ? file.name : "Attach PDF"}
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
