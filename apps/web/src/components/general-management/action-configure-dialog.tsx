import { Loader2, Mail, X } from "lucide-react";
import { useEffect, useState } from "react";
import CommentEditor from "@/components/activity/comment-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MeetingAction } from "@/fetchers/meeting";
import {
  useActionMemo,
  useSendActionMemo,
} from "@/hooks/queries/meeting/use-action-memo";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

const DEFAULT_REPLY_TO = "governance@mapim.org";

/**
 * The documented shortcode vocabulary, mirrored from `MEMO_SHORTCODES` in
 * `apps/api/src/meeting/memorandum.ts` — NOT imported from there. That
 * module is the API's internals, not this app's to reach across the
 * app boundary for. `action-configure-dialog.test.tsx` reads that file as
 * text and regexes the tokens out of it, then asserts this list matches
 * exactly (both the token set and its length) — a hard-coded expectation
 * compared against this hard-coded mirror would prove nothing, so the
 * test is what actually keeps the two from drifting apart.
 */
const MEMO_SHORTCODES = [
  { token: "meeting_name", description: "Name of the meeting" },
  { token: "meeting_date", description: "Date of the meeting" },
  { token: "numbering", description: "The action's numbering (e.g. 3.2)" },
  { token: "topic", description: "The action's topic" },
  { token: "status", description: "The action's current status" },
  {
    token: "recipient_name",
    description: "Name of the memorandum recipient",
  },
  {
    token: "action_table",
    description: "One-row table of the action's numbering, topic and status",
  },
  { token: "notes", description: "Optional extra notes" },
] as const;

function isValidEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

/**
 * The "Configure -> send memorandum" popup for one meeting action: its
 * detail, then a send-out form for a formal memorandum email to an outside
 * recipient, pre-filled from `GET /:id/actions/:actionId/memo` — the single
 * source of truth for the default template, resolved shortcode values, and
 * whether one was already sent.
 */
export function ActionConfigureDialog({
  workspaceId,
  meetingId,
  action,
  open,
  onClose,
}: {
  workspaceId: string;
  meetingId: string;
  action: MeetingAction | null;
  open: boolean;
  onClose: () => void;
}) {
  const actionId = action?.id ?? "";
  const { data, isLoading, isError, refetch } = useActionMemo(
    workspaceId,
    meetingId,
    actionId,
    open && Boolean(action),
  );
  const send = useSendActionMemo(workspaceId, meetingId, actionId);

  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO);
  const [ccInput, setCcInput] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  // Guards the hydration effect below so it seeds the form once per opened
  // action, rather than clobbering an in-progress edit every time the
  // query happens to refetch (e.g. the invalidation after a send).
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setHydratedFor(null);
      return;
    }
    if (!data || hydratedFor === actionId) return;
    setBodyMarkdown(data.defaultTemplate);
    setRecipientName(data.values.recipient_name);
    setNotes(data.values.notes);
    setReplyTo(DEFAULT_REPLY_TO);
    setRecipientEmail("");
    setCc([]);
    setCcInput("");
    setHydratedFor(actionId);
  }, [open, data, actionId, hydratedFor]);

  const addCc = () => {
    const trimmed = ccInput.trim();
    if (!trimmed) return;
    if (!isValidEmail(trimmed)) {
      toast.error("Enter a valid email to add as CC");
      return;
    }
    setCc((current) =>
      current.includes(trimmed) ? current : [...current, trimmed],
    );
    setCcInput("");
  };

  const removeCc = (email: string) => {
    setCc((current) => current.filter((entry) => entry !== email));
  };

  const canSend =
    Boolean(recipientName.trim()) &&
    isValidEmail(recipientEmail) &&
    Boolean(bodyMarkdown.trim()) &&
    !send.isPending;

  const handleSend = () => {
    send.mutate(
      {
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        notes: notes.trim() || undefined,
        replyTo: replyTo.trim() || undefined,
        cc: cc.length > 0 ? cc : undefined,
        bodyMarkdown,
      },
      {
        onSuccess: () => {
          toast.success("Memorandum sent");
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to send memorandum",
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Configure Meeting Minutes memorandum</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div
            className="flex h-40 items-center justify-center"
            role="status"
            aria-label="Loading memorandum"
          >
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div
            className="flex h-40 flex-col items-center justify-center gap-3 text-center"
            role="alert"
          >
            <p className="text-sm">Couldn't load this memorandum</p>
            <p className="text-muted-foreground text-xs">
              Something went wrong fetching this action's memorandum context.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : !data || !action ? (
          <p className="text-muted-foreground text-sm">No data available.</p>
        ) : (
          <div className="space-y-4 overflow-y-auto px-1 pb-1">
            <div className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
              <div className="text-muted-foreground text-xs">
                Meeting Minutes action
              </div>
              <p className="whitespace-pre-wrap">{action.description}</p>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                {data.values.numbering && (
                  <Badge variant="outline">{data.values.numbering}</Badge>
                )}
                <span>{data.values.topic}</span>
                <Badge variant="outline">{data.values.status}</Badge>
              </div>
            </div>

            {data.lastSend ? (
              <div
                className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                data-testid="last-send"
              >
                <div className="flex items-center gap-1.5 font-medium text-xs">
                  <Mail className="h-3.5 w-3.5" />
                  Memorandum already sent — sending again will not be prevented,
                  so check before repeating it
                </div>
                <p className="text-muted-foreground text-xs">
                  To {data.lastSend.recipientName} (
                  {data.lastSend.recipientEmail}) on{" "}
                  {formatDateMedium(data.lastSend.sentAt)}
                </p>
              </div>
            ) : (
              <p
                className="text-muted-foreground text-xs"
                data-testid="no-last-send"
              >
                No memorandum has been sent for this action yet.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="memo-recipient-name"
                >
                  Recipient name
                </label>
                <Input
                  id="memo-recipient-name"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="memo-recipient-email"
                >
                  Recipient email
                </label>
                <Input
                  id="memo-recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                className="text-muted-foreground text-xs"
                htmlFor="memo-notes"
              >
                Extra notes (optional)
              </label>
              <Textarea
                id="memo-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="memo-reply-to"
                >
                  Reply-to
                </label>
                <Input
                  id="memo-reply-to"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="memo-cc"
                >
                  CC
                </label>
                <div className="flex gap-1.5">
                  <Input
                    id="memo-cc"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCc();
                      }
                    }}
                    placeholder="add@example.com"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCc}
                  >
                    Add
                  </Button>
                </div>
                {cc.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {cc.map((email) => (
                      <Badge
                        key={email}
                        variant="outline"
                        className="flex items-center gap-1 text-xs"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeCc(email)}
                          aria-label={`Remove ${email}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-muted-foreground text-xs">
                Memorandum body
              </div>
              <CommentEditor
                value={bodyMarkdown}
                onChange={setBodyMarkdown}
                showBubbleMenu={false}
              />
            </div>

            <div
              className="space-y-1 rounded-md border border-border px-3 py-2 text-xs"
              data-testid="memo-shortcode-list"
            >
              <p className="font-medium">Available shortcodes</p>
              <ul className="space-y-0.5">
                {MEMO_SHORTCODES.map((shortcode) => (
                  <li key={shortcode.token}>
                    <code>{`{{${shortcode.token}}}`}</code> —{" "}
                    {shortcode.description}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Shortcodes are safe as plain text only — never place one inside
                an HTML attribute, a URL, or a style value; it is not sanitised
                for those contexts.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!canSend} onClick={handleSend}>
                {send.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Send memorandum
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
