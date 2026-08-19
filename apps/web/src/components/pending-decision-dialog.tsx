import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  PendingDecisionError,
  type PendingDecisionItem,
} from "@/fetchers/pending-decision";
import { useDecidePending } from "@/hooks/mutations/pending-decision/use-decide-pending";
import { usePendingDecisions } from "@/hooks/queries/pending-decision/use-pending-decisions";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  isIdleForDialog,
  shouldAutoOpen,
} from "@/hooks/use-pending-dialog-open";
import { toast } from "@/lib/toast";

const HOME_PATH = "/dashboard/home";

let openDialog: (() => void) | null = null;
export function openPendingDecisions() {
  openDialog?.();
}

function ItemCard({
  item,
  workspaceId,
  onDone,
  onOpen,
}: {
  item: PendingDecisionItem;
  workspaceId: string;
  onDone: (id: string) => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate, isPending } = useDecidePending(workspaceId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [gone, setGone] = useState(false);

  const decide = (decision: "accepted" | "rejected", value: string | null) =>
    mutate(
      { source: item.source, id: item.id, decision, reason: value },
      {
        onSuccess: () => onDone(item.id),
        onError: (error: unknown) => {
          // Losing a footrace is not a failure worth shouting about: someone
          // else already handled this, which is the outcome we wanted anyway.
          if (error instanceof PendingDecisionError && error.status === 409) {
            setGone(true);
            return;
          }
          toast.error(
            error instanceof Error
              ? error.message
              : t("pendingDecisions:genericError"),
          );
        },
      },
    );

  if (gone)
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {t("pendingDecisions:alreadyHandled")}
      </div>
    );

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="font-medium">{item.title}</div>
      <div className="text-sm text-muted-foreground">{item.subtitle}</div>
      {item.context.map((line) => (
        <div key={line} className="text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      <a
        href={item.href}
        className="text-xs underline underline-offset-2 inline-block"
        onClick={(event) => {
          // A modified click (new tab / new window / middle click) is asking
          // for a real anchor, not an in-app navigation — let the browser
          // handle it natively, same as before this was wired to the router.
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.button !== 0
          )
            return;
          // A full page reload would remount this dialog fresh with
          // dismissed=false, so it auto-opens again on top of the very item
          // the user just asked to read. Navigate client-side instead, and
          // close the dialog out of the way.
          event.preventDefault();
          navigate({ to: item.href });
          onOpen();
        }}
      >
        {t("pendingDecisions:open")}
      </a>

      {rejecting ? (
        <div className="space-y-2 pt-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("pendingDecisions:reasonPlaceholder")}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || isPending}
              onClick={() => decide("rejected", reason.trim())}
            >
              {t("pendingDecisions:confirmRejection")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRejecting(false)}
            >
              {t("pendingDecisions:cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => decide("accepted", null)}
          >
            {t("pendingDecisions:accept")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRejecting(true)}
          >
            {t("pendingDecisions:reject")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PendingDecisionDialog() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data } = usePendingDecisions(workspace?.id ?? "");
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [decided, setDecided] = useState<string[]>([]);

  const items = (data?.items ?? []).filter((i) => !decided.includes(i.id));
  const failed = data?.failedSources ?? [];

  // Landing on Home clears the dismissal: the dot must never be the only thing
  // standing between someone and a decision they owe.
  const path = location.pathname;
  const lastPath = useRef(path);
  useEffect(() => {
    if (path !== lastPath.current && path === HOME_PATH) setDismissed(false);
    lastPath.current = path;
  }, [path]);

  useEffect(() => {
    if (
      shouldAutoOpen({
        hasPending: items.length > 0,
        isIdle: isIdleForDialog(document.activeElement),
        alreadyOpen: open,
        dismissed,
      })
    )
      setOpen(true);
  }, [items.length, open, dismissed]);

  // The last decision closes the dialog rather than leaving an empty shell.
  useEffect(() => {
    if (open && items.length === 0 && failed.length === 0) setOpen(false);
  }, [open, items.length, failed.length]);

  useEffect(() => {
    openDialog = () => {
      setDismissed(false);
      setOpen(true);
    };
    return () => {
      openDialog = null;
    };
  }, []);

  if (!workspace) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setDismissed(true);
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("pendingDecisions:title")}</DialogTitle>
          <DialogDescription>
            {t("pendingDecisions:description")}
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {t("pendingDecisions:partialFailure", {
              sources: failed.join(", "),
            })}
          </div>
        )}
        <div className="space-y-3 overflow-y-auto">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              workspaceId={workspace.id}
              onDone={(id) => setDecided((prev) => [...prev, id])}
              onOpen={() => {
                setOpen(false);
                setDismissed(true);
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
