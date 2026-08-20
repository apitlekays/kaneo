import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ThreadEntry } from "@/fetchers/correspondence/letters";
import { useLetterThread } from "@/hooks/queries/correspondence/use-letters";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { letterReference } from "@/lib/letter-reference";

export function LetterThreadDialog({
  workspaceId,
  letterId,
  onClose,
  onOpenLetter,
}: {
  workspaceId: string;
  letterId: string | null;
  onClose: () => void;
  onOpenLetter: (id: string) => void;
}) {
  const { data, isLoading } = useLetterThread(workspaceId, letterId);

  return (
    <Dialog
      open={Boolean(letterId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Letter thread</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {isLoading || !data ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {data.truncated && (
                <p className="mb-3 text-muted-foreground text-xs">
                  This thread was too long to show in full. Showing the 100
                  letters most closely linked to this one.
                </p>
              )}
              <ul className="space-y-2">
                {/* The API already sorts this list newest-first — do not
                re-sort it here. */}
                {data.letters.map((entry: ThreadEntry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onOpenLetter(entry.id)}
                      className={cn(
                        "w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted",
                        entry.isSeed && "border-primary bg-primary/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">
                          {letterReference(entry)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {entry.isSeed && (
                            <Badge variant="outline" className="text-xs">
                              This letter
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {entry.direction === "in" ? "Masuk" : "Keluar"}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-1 font-medium text-sm">
                        {entry.subject}
                      </div>
                      <div className="mt-1 text-muted-foreground text-xs">
                        {formatDateMedium(entry.date)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
