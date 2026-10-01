import { Check, Copy, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";

export type ConfirmIdentifier = {
  /** e.g. "Name", "Serial no." */
  label: string;
  value: string;
};

type TypedConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /**
   * What the user may type to confirm — any one of them unlocks the button.
   * Each is shown with a copy button so it can be pasted rather than retyped.
   */
  identifiers: ConfirmIdentifier[];
  confirmText?: string;
  pending?: boolean;
  onConfirm: () => void;
};

/**
 * A destructive confirmation that cannot be clicked through: the confirm
 * button stays disabled until the user types (or pastes) the record's name
 * or ID exactly. Use it for deletions that cannot be undone, where a plain
 * "Are you sure?" is too easy to dismiss by reflex.
 */
export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  identifiers,
  confirmText = "Delete",
  pending = false,
  onConfirm,
}: TypedConfirmDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Start empty every time it opens, so a previous answer never carries over.
  useEffect(() => {
    if (open) {
      setTyped("");
      setCopied(null);
    }
  }, [open]);

  const matches = identifiers.some(
    (identifier) =>
      identifier.value.trim() !== "" &&
      typed.trim() === identifier.value.trim(),
  );

  const copy = async (identifier: ConfirmIdentifier) => {
    try {
      await navigator.clipboard.writeText(identifier.value);
      setCopied(identifier.label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Could not copy — select and copy it instead");
    }
  };

  const labels = identifiers.map((i) => i.label.toLowerCase()).join(" or ");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <div className="space-y-3 px-6">
          <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5">
            {identifiers.map((identifier) => (
              <div
                key={identifier.label}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-24 shrink-0 text-muted-foreground text-xs">
                  {identifier.label}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs">
                  {identifier.value}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0"
                  onClick={() => copy(identifier)}
                  aria-label={`Copy ${identifier.label.toLowerCase()}`}
                  title={`Copy ${identifier.label.toLowerCase()}`}
                >
                  {copied === identifier.label ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm">
              Type the {labels} to confirm
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches && !pending) onConfirm();
              }}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!matches || pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default TypedConfirmDialog;
